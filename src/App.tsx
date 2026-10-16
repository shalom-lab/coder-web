import { useCallback, useEffect, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { RulesUiEditor } from './components/RulesUiEditor'
import { Settings } from './components/Settings'
import { Toast } from './components/Toast'
import {
  CACHE_KEYS,
  DEFAULT_RULES,
  REPO_FILE,
  assertRulesReady,
  generateFromRules,
  parseRulesJson,
  prettyJson,
  rulesFromFileContent,
  type Rule,
} from './lib/bookmarklet'
import { readByok, type ByokSettings } from './lib/byok'
import { fetchRepoFile, putRepoFile, tryGetFileSha } from './lib/github'
import './App.css'

type EditorMode = 'json' | 'ui'

/** React 会拦截 href="javascript:..."，必须用 setAttribute 才能拖成书签 */
function BookmarkDragLink({
  href,
  label,
  onClickHint,
}: {
  href: string
  label: string
  onClickHint: () => void
}) {
  const ref = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !href) return
    el.setAttribute('href', href)
  }, [href])

  return (
    <a
      ref={ref}
      className="bookmark-preview"
      href="#"
      title="拖拽到书签栏使用（不要在本页点击）"
      draggable
      onClick={(e) => {
        e.preventDefault()
        onClickHint()
      }}
    >
      {label}
    </a>
  )
}

export default function App() {
  const [byok, setByok] = useState<ByokSettings>(() => readByok())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [name, setName] = useState(() => localStorage.getItem(CACHE_KEYS.name) || 'Go')
  const [jsonText, setJsonText] = useState(() => {
    const cached = localStorage.getItem(CACHE_KEYS.rules)
    if (cached) return cached
    return prettyJson(DEFAULT_RULES)
  })
  const [editorMode, setEditorMode] = useState<EditorMode>('json')
  const [output, setOutput] = useState('')
  const [toast, setToast] = useState({ message: '', visible: false })
  const [fileSha, setFileSha] = useState<string | undefined>()
  /** 最近一次拉取/保存到云端的规范化 JSON；null 表示本会话尚未与云端同步 */
  const [cloudSnapshot, setCloudSnapshot] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true })
  }, [])

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, visible: false }))
  }, [])

  let uiRules: Rule[] | null = null
  try {
    uiRules = parseRulesJson(jsonText)
  } catch {
    uiRules = null
  }

  const switchMode = (mode: EditorMode) => {
    if (mode === editorMode) return
    if (mode === 'ui') {
      try {
        const rules = parseRulesJson(jsonText)
        setJsonText(prettyJson(rules))
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'JSON 无效，无法切换到 UI')
        return
      }
    } else if (uiRules) {
      setJsonText(prettyJson(uiRules))
    }
    setEditorMode(mode)
  }

  const handleUiRulesChange = (rules: Rule[]) => {
    setJsonText(prettyJson(rules))
  }

  useEffect(() => {
    localStorage.setItem(CACHE_KEYS.rules, jsonText)
  }, [jsonText])

  useEffect(() => {
    localStorage.setItem(CACHE_KEYS.name, name)
  }, [name])

  const formatJson = () => {
    try {
      const formatted = prettyJson(parseRulesJson(jsonText))
      setJsonText(formatted)
      showToast('已格式化')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'JSON 无效')
    }
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.js,.txt'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const text = String(reader.result ?? '')
        try {
          setJsonText(prettyJson(rulesFromFileContent(text)))
          showToast('导入成功')
        } catch (e) {
          showToast(e instanceof Error ? e.message : '导入失败')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleExportLocal = () => {
    try {
      const formatted = prettyJson(parseRulesJson(jsonText))
      setJsonText(formatted)
      const blob = new Blob([formatted], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'rules.json'
      a.click()
      URL.revokeObjectURL(url)
      showToast('已导出到本地')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '导出失败')
    }
  }

  const handleClear = () => {
    if (!window.confirm('确定清空吗？')) return
    setJsonText(prettyJson(DEFAULT_RULES))
    setOutput('')
    setFileSha(undefined)
    localStorage.removeItem(CACHE_KEYS.rules)
    showToast('已重置为默认规则')
  }

  const handleGenerate = async () => {
    try {
      const rules = parseRulesJson(jsonText)
      assertRulesReady(rules)
      const formatted = prettyJson(rules)
      setJsonText(formatted)
      const url = generateFromRules(rules)
      setOutput(url)
      await navigator.clipboard.writeText(url)
      showToast('已压缩并复制到剪贴板')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '生成失败')
    }
  }

  const pullFromGithub = async () => {
    setBusy(true)
    try {
      const { content, sha } = await fetchRepoFile(byok, REPO_FILE)
      const formatted = prettyJson(rulesFromFileContent(content))
      setJsonText(formatted)
      setCloudSnapshot(formatted)
      setFileSha(sha)
      showToast('已从仓库拉取')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setBusy(false)
    }
  }

  /** 保存 = 写入仓库根目录 rules.json（仅规则数据） */
  const handleSave = async () => {
    if (!byok.repo || !byok.token) {
      showToast('请先在设置中配置仓库与 Token')
      setSettingsOpen(true)
      return
    }
    setBusy(true)
    try {
      const rules = parseRulesJson(jsonText)
      assertRulesReady(rules)
      const formatted = prettyJson(rules)
      setJsonText(formatted)
      // 私库已有文件时更新必须带 sha；先探测，避免无权限时被误当成「文件不存在」
      const sha = fileSha ?? (await tryGetFileSha(byok, REPO_FILE))
      await putRepoFile(byok, REPO_FILE, formatted, `update ${REPO_FILE}`, sha)
      const latest = await fetchRepoFile(byok, REPO_FILE)
      const synced = prettyJson(rulesFromFileContent(latest.content))
      setJsonText(synced)
      setCloudSnapshot(synced)
      setFileSha(latest.sha)
      showToast(`已保存到 ${byok.repo}/${REPO_FILE}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const byokReady = Boolean(byok.repo && byok.token)
  const hasJson = jsonText.trim().length > 0
  let normalizedJson: string | null = null
  try {
    normalizedJson = prettyJson(parseRulesJson(jsonText))
  } catch {
    normalizedJson = null
  }
  const isDirty =
    cloudSnapshot === null
      ? hasJson
      : normalizedJson !== null && normalizedJson !== cloudSnapshot
  const canSaveToCloud = hasJson && isDirty && normalizedJson !== null
  const bookmarkName = name.trim() || 'Go'

  return (
    <div className="container">
      <header className="header">
        <h1>Bookmarklet 规则编辑器</h1>
        <div className="header-right">
          <div className="stats">
            <span>JSON: {jsonText.length}</span>
            <span>压缩后: {output.length || 0}</span>
          </div>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            {byokReady ? '设置 ✓' : '设置'}
          </button>
        </div>
      </header>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-header">
            <div className="panel-title">
              <span>规则</span>
              <div className="mode-tabs" role="tablist" aria-label="编辑模式">
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorMode === 'json'}
                  className={editorMode === 'json' ? 'mode-tab is-active' : 'mode-tab'}
                  onClick={() => switchMode('json')}
                >
                  JSON
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={editorMode === 'ui'}
                  className={editorMode === 'ui' ? 'mode-tab is-active' : 'mode-tab'}
                  onClick={() => switchMode('ui')}
                >
                  UI
                </button>
              </div>
              <div className="name-input-group">
                <span>名称:</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-label="书签名称"
                />
              </div>
            </div>
            <div className="panel-header-actions">
              {editorMode === 'json' ? (
                <button type="button" className="header-chip-btn" onClick={formatJson}>
                  格式化
                </button>
              ) : null}
            </div>
          </div>

          <div className="editor-wrap">
            {editorMode === 'json' ? (
              <Editor
                height="100%"
                defaultLanguage="json"
                theme="vs-dark"
                value={jsonText}
                onChange={(v) => setJsonText(v ?? '')}
                options={{
                  fontSize: 13,
                  fontFamily: "'Fira Code', Consolas, 'Courier New', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  formatOnPaste: true,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  renderLineHighlight: 'line',
                  bracketPairColorization: { enabled: true },
                }}
              />
            ) : uiRules ? (
              <RulesUiEditor rules={uiRules} onChange={handleUiRulesChange} />
            ) : (
              <div className="rules-ui-error">
                <p>当前 JSON 无法解析，请先切回 JSON 模式修复。</p>
                <button type="button" onClick={() => setEditorMode('json')}>
                  返回 JSON
                </button>
              </div>
            )}
          </div>

          <div className="panel-footer">
            <div className="btn-group">
              <button type="button" disabled={busy || !byokReady} onClick={pullFromGithub}>
                拉取
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !canSaveToCloud}
                onClick={handleSave}
                title={
                  !byokReady
                    ? '需先配置 BYOK'
                    : !isDirty
                      ? '内容未改动'
                      : `保存到 ${byok.repo}/${REPO_FILE}`
                }
              >
                保存到云端
              </button>
              <button type="button" onClick={handleImport}>
                导入
              </button>
              <button type="button" disabled={!hasJson} onClick={handleExportLocal}>
                导出
              </button>
              <button type="button" onClick={handleClear}>
                清空
              </button>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <span>生成结果</span>
            {output ? (
              <BookmarkDragLink
                href={output}
                label={bookmarkName}
                onClickHint={() => showToast('请拖到浏览器书签栏，勿在本页点击')}
              />
            ) : null}
          </div>

          <textarea
            className="output-area"
            readOnly
            value={output}
            placeholder="压缩后的 javascript: 链接将出现在这里..."
          />

          <div className="panel-footer panel-footer-end">
            <button type="button" className="primary" onClick={handleGenerate}>
              压缩并复制
            </button>
          </div>
        </section>
      </div>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={setByok}
      />
      <Toast message={toast.message} visible={toast.visible} onHide={hideToast} />
    </div>
  )
}

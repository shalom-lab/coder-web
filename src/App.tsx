import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { RulesUiEditor } from './components/RulesUiEditor'
import { Settings } from './components/Settings'
import { Toast } from './components/Toast'
import {
  CACHE_KEYS,
  DEFAULT_RULES,
  REPO_FILE,
  assertRulesReady,
  generateFromRules,
  normalizeRulesText,
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
    if (!cached) return prettyJson(DEFAULT_RULES)
    return normalizeRulesText(cached) ?? cached
  })
  const [editorMode, setEditorMode] = useState<EditorMode>('ui')
  const [output, setOutput] = useState('')
  const [toast, setToast] = useState({ message: '', visible: false })
  const [fileSha, setFileSha] = useState<string | undefined>()
  const monacoRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

  const scrollJsonToEnd = useCallback(() => {
    const ed = monacoRef.current
    if (!ed) return
    const model = ed.getModel()
    if (!model) return
    const lastLine = model.getLineCount()
    ed.revealLine(lastLine)
    ed.setScrollTop(ed.getScrollHeight())
  }, [])

  const handleEditorMount: OnMount = (ed) => {
    monacoRef.current = ed
    // 切到 JSON 时编辑器会挂载：默认滚到末尾；之后用户可自行滚动
    requestAnimationFrame(() => scrollJsonToEnd())
  }
  /**
   * 仅在真正拉取/保存成功后写入；刷新后从专用 key 恢复。
   * 禁止用本地草稿冒充，否则会误判「未改动」导致无法保存。
   */
  const [cloudSnapshot, setCloudSnapshot] = useState<string | null>(() => {
    const saved = localStorage.getItem(CACHE_KEYS.cloudSnapshot)
    if (!saved) return null
    return normalizeRulesText(saved) ?? null
  })
  const [busy, setBusy] = useState(false)

  const rememberCloudSnapshot = useCallback((formatted: string) => {
    const normalized = normalizeRulesText(formatted) ?? formatted
    setCloudSnapshot(normalized)
    localStorage.setItem(CACHE_KEYS.cloudSnapshot, normalized)
  }, [])

  const clearCloudSnapshot = useCallback(() => {
    setCloudSnapshot(null)
    localStorage.removeItem(CACHE_KEYS.cloudSnapshot)
  }, [])

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
    // 能解析则存规范化结果，避免格式残留；解析失败仍存原文以免丢草稿
    localStorage.setItem(CACHE_KEYS.rules, normalizeRulesText(jsonText) ?? jsonText)
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

  /** 仅清空本机编辑器与本地缓存，不改云端 rules.json */
  const handleClear = () => {
    if (!window.confirm('仅清空本地编辑内容（不会删除云端），确定？')) return
    setJsonText(prettyJson(DEFAULT_RULES))
    setOutput('')
    setFileSha(undefined)
    localStorage.removeItem(CACHE_KEYS.rules)
    clearCloudSnapshot()
    showToast('已清空本地，云端未改动')
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
    // 每次从 localStorage 重读，避免 React 状态里 token 过期/被误清空
    const settings = readByok()
    setByok(settings)
    if (!settings.repo || !settings.token) {
      showToast('请先在设置中配置仓库与 Token')
      setSettingsOpen(true)
      return
    }
    setBusy(true)
    try {
      const { content, sha } = await fetchRepoFile(settings, REPO_FILE)
      const formatted = prettyJson(rulesFromFileContent(content))
      setJsonText(formatted)
      rememberCloudSnapshot(formatted)
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
    const settings = readByok()
    setByok(settings)
    if (!settings.repo || !settings.token) {
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
      const sha = fileSha ?? (await tryGetFileSha(settings, REPO_FILE))
      await putRepoFile(settings, REPO_FILE, formatted, `update ${REPO_FILE}`, sha)
      const latest = await fetchRepoFile(settings, REPO_FILE)
      const synced = prettyJson(rulesFromFileContent(latest.content))
      setJsonText(synced)
      rememberCloudSnapshot(synced)
      setFileSha(latest.sha)
      showToast(`已保存到 ${settings.repo}/${REPO_FILE}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const byokReady = Boolean(byok.repo && byok.token)
  const hasJson = jsonText.trim().length > 0
  const normalizedJson = normalizeRulesText(jsonText)
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
                onMount={handleEditorMount}
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
                disabled={busy || !byokReady || !canSaveToCloud}
                onClick={handleSave}
                title={
                  !byokReady
                    ? '需先配置仓库与 Token'
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
              <button
                type="button"
                onClick={handleClear}
                title="仅清空本机内容，不影响云端"
              >
                本地清空
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

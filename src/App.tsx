import { useCallback, useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Settings } from './components/Settings'
import { Toast } from './components/Toast'
import {
  CACHE_KEYS,
  DEFAULT_RULES,
  extractRulesFromJs,
  generateFromRules,
  parseRulesJson,
  prettyJson,
} from './lib/bookmarklet'
import { readByok, type ByokSettings } from './lib/byok'
import { fetchRepoFile, putRepoFile } from './lib/github'
import './App.css'

const REPO_FILE = 'rules.json'

export default function App() {
  const [byok, setByok] = useState<ByokSettings>(() => readByok())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [name, setName] = useState(() => localStorage.getItem(CACHE_KEYS.name) || 'Go')
  const [jsonText, setJsonText] = useState(() => {
    const cached = localStorage.getItem(CACHE_KEYS.rules)
    if (cached) return cached
    return prettyJson(DEFAULT_RULES)
  })
  const [output, setOutput] = useState('')
  const [toast, setToast] = useState({ message: '', visible: false })
  const [fileSha, setFileSha] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  const showToast = useCallback((message: string) => {
    setToast({ message, visible: true })
  }, [])

  const hideToast = useCallback(() => {
    setToast((t) => ({ ...t, visible: false }))
  }, [])

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
          if (file.name.endsWith('.js')) {
            const rules = extractRulesFromJs(text)
            if (!rules) {
              showToast('无法从 JS 提取 ruleList')
              return
            }
            setJsonText(prettyJson(rules))
          } else {
            setJsonText(prettyJson(parseRulesJson(text)))
          }
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
      a.download = REPO_FILE
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
      setJsonText(prettyJson(parseRulesJson(content)))
      setFileSha(sha)
      showToast('已从仓库拉取')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setBusy(false)
    }
  }

  /** 保存 = 写入仓库根目录 rules.json */
  const handleSave = async () => {
    if (!byok.repo || !byok.token) {
      showToast('请先在设置中配置仓库与 Token')
      setSettingsOpen(true)
      return
    }
    setBusy(true)
    try {
      const formatted = prettyJson(parseRulesJson(jsonText))
      setJsonText(formatted)
      let sha = fileSha
      if (!sha) {
        try {
          const existing = await fetchRepoFile(byok, REPO_FILE)
          sha = existing.sha
        } catch {
          // 仓库里还没有该文件，创建新文件
        }
      }
      await putRepoFile(byok, REPO_FILE, formatted, `update ${REPO_FILE}`, sha)
      const latest = await fetchRepoFile(byok, REPO_FILE)
      setFileSha(latest.sha)
      showToast(`已保存到 ${byok.repo}/${REPO_FILE}`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  const byokReady = Boolean(byok.repo && byok.token)
  const canSave = jsonText.trim().length > 0
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
              <span>规则 JSON</span>
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
              <span className="tag">JSON</span>
              <button type="button" onClick={formatJson}>
                格式化
              </button>
            </div>
          </div>

          <div className="editor-wrap">
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
          </div>

          <div className="panel-footer">
            <div className="btn-group">
              <button type="button" disabled={busy || !byokReady} onClick={pullFromGithub}>
                拉取
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy || !canSave}
                onClick={handleSave}
                title={byokReady ? `保存到 ${byok.repo}/${REPO_FILE}` : '需先配置 BYOK'}
              >
                保存到云端
              </button>
              <button type="button" onClick={handleImport}>
                导入
              </button>
              <button type="button" disabled={!canSave} onClick={handleExportLocal}>
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
              <a
                className="bookmark-preview"
                href={output}
                title="拖拽到书签栏"
                onClick={(e) => e.preventDefault()}
              >
                {bookmarkName}
              </a>
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

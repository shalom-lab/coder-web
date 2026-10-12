import { useEffect, useState } from 'react'
import {
  BYOK_KEYS,
  clearByok,
  maskSecret,
  readByok,
  saveByok,
  type ByokSettings,
} from '../lib/byok'

type Props = {
  open: boolean
  onClose: () => void
  onSaved: (settings: ByokSettings) => void
}

export function Settings({ open, onClose, onSaved }: Props) {
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [tokenDirty, setTokenDirty] = useState(false)
  const [saved, setSaved] = useState<ByokSettings>({ repo: '', token: '' })

  useEffect(() => {
    if (!open) return
    const current = readByok()
    setSaved(current)
    setRepo(current.repo)
    setToken('')
    setTokenDirty(false)
  }, [open])

  if (!open) return null

  const handleSave = () => {
    const next: ByokSettings = {
      repo: repo.trim(),
      token: tokenDirty ? token.trim() : saved.token,
    }
    saveByok(next)
    onSaved(next)
    onClose()
  }

  const handleClear = () => {
    if (!window.confirm('确定清除已保存的仓库与 Token？')) return
    clearByok()
    const empty = { repo: '', token: '' }
    onSaved(empty)
    setSaved(empty)
    setRepo('')
    setToken('')
    setTokenDirty(false)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <h2 id="settings-title">设置 · BYOK</h2>
          <button type="button" className="ghost" onClick={onClose}>
            关闭
          </button>
        </div>

        <p className="hint">
          密钥只存本机 <code>localStorage</code>。私有仓库必须用 PAT 授权该库（网页能看见不算数）；
          fine-grained 勾选仓库 + Contents Read and write。
        </p>

        <label className="field">
          <span>
            仓库 <code>{BYOK_KEYS.repo}</code>
          </span>
          <input
            type="text"
            placeholder="owner/repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            autoComplete="off"
          />
          <small>{saved.repo ? `已保存：${saved.repo}` : '未设置'}</small>
        </label>

        <label className="field">
          <span>
            Token <code>{BYOK_KEYS.token}</code>
          </span>
          <input
            type="password"
            placeholder={saved.token ? `已保存 ${maskSecret(saved.token)}` : 'GitHub PAT'}
            value={token}
            onChange={(e) => {
              setToken(e.target.value)
              setTokenDirty(true)
            }}
            autoComplete="off"
          />
          <small>{saved.token ? '已保存（仅显示末 4 位）' : '未设置'}</small>
        </label>

        <div className="modal-actions">
          <button type="button" onClick={handleClear}>
            清除
          </button>
          <button type="button" className="primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}

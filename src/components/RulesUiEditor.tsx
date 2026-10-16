import { useState } from 'react'
import type { Rule, StorageItem } from '../lib/bookmarklet'

type Props = {
  rules: Rule[]
  onChange: (rules: Rule[]) => void
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return ''
  return JSON.stringify(value)
}

function textToValue(text: string): unknown {
  const trimmed = text.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      return JSON.parse(trimmed) as unknown
    } catch {
      return text
    }
  }
  return text
}

/** storage 项通常是单键对象；多键时展开为多行编辑 */
function flattenStorage(storage: StorageItem[]): { key: string; valueText: string }[] {
  const rows: { key: string; valueText: string }[] = []
  for (const item of storage) {
    const entries = Object.entries(item)
    if (entries.length === 0) {
      rows.push({ key: '', valueText: '' })
      continue
    }
    for (const [key, value] of entries) {
      rows.push({ key, valueText: valueToText(value) })
    }
  }
  return rows
}

function rowsToStorage(rows: { key: string; valueText: string }[]): StorageItem[] {
  return rows.map(({ key, valueText }) => {
    const k = key.trim() || 'key'
    return { [k]: textToValue(valueText) }
  })
}

export function RulesUiEditor({ rules, onChange }: Props) {
  const [openSet, setOpenSet] = useState<Set<number>>(() => new Set(rules.length ? [0] : []))

  const toggle = (index: number) => {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const updateRule = (index: number, patch: Partial<Rule>) => {
    const next = rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule))
    onChange(next)
  }

  const updateStorageRows = (ruleIndex: number, rows: { key: string; valueText: string }[]) => {
    updateRule(ruleIndex, { storage: rowsToStorage(rows) })
  }

  const defaultStorage = (): StorageItem[] => [
    { 'gh-name-repo': 'shalom-lab/' },
    { 'gh-name-token': '' },
  ]

  const addRule = () => {
    const next: Rule[] = [
      ...rules,
      { urlpattern: 'github.io/', storage: defaultStorage() },
    ]
    onChange(next)
    setOpenSet((prev) => new Set(prev).add(next.length - 1))
  }

  const addStorageRow = (ruleIndex: number, rows: { key: string; valueText: string }[]) => {
    const keys = new Set(rows.map((r) => r.key.trim()))
    let key = 'gh-name-repo'
    let valueText = 'shalom-lab/'
    if (keys.has('gh-name-repo') && !keys.has('gh-name-token')) {
      key = 'gh-name-token'
      valueText = ''
    } else if (keys.has('gh-name-repo') && keys.has('gh-name-token')) {
      key = ''
      valueText = ''
    }
    updateStorageRows(ruleIndex, [...rows, { key, valueText }])
  }

  return (
    <div className="rules-ui">
      {rules.length === 0 ? (
        <p className="rules-ui-empty">暂无规则，点击下方「新增规则」开始</p>
      ) : null}

      <div className="rules-ui-scroll">
        {rules.map((rule, ruleIndex) => {
          const open = openSet.has(ruleIndex)
          const rows = flattenStorage(rule.storage)
          const label = rule.urlpattern.trim() || `规则 ${ruleIndex + 1}`

          return (
            <div
              key={ruleIndex}
              className={`accordion-item${open ? ' is-open' : ''}`}
            >
              <button
                type="button"
                className="accordion-toggle"
                aria-expanded={open}
                onClick={() => toggle(ruleIndex)}
              >
                <span className="accordion-chevron" aria-hidden>
                  {open ? '▾' : '▸'}
                </span>
                <span className="accordion-title" title={label}>
                  {label}
                </span>
                <span className="accordion-meta">{rows.length} 项</span>
              </button>

              {open ? (
                <div className="accordion-body">
                  <label className="ui-field">
                    <span>urlpattern</span>
                    <input
                      type="text"
                      value={rule.urlpattern}
                      placeholder="例如 github.io/Spark"
                      onChange={(e) => updateRule(ruleIndex, { urlpattern: e.target.value })}
                    />
                  </label>

                  <div className="storage-block">
                    <div className="storage-block-title">storage</div>
                    {rows.map((row, rowIndex) => (
                      <div key={rowIndex} className="storage-row">
                        <input
                          type="text"
                          className="storage-key"
                          value={row.key}
                          placeholder="键名"
                          aria-label={`storage 键 ${rowIndex + 1}`}
                          onChange={(e) => {
                            const next = rows.map((r, i) =>
                              i === rowIndex ? { ...r, key: e.target.value } : r,
                            )
                            updateStorageRows(ruleIndex, next)
                          }}
                        />
                        <input
                          type="text"
                          className="storage-value"
                          value={row.valueText}
                          placeholder="值"
                          aria-label={`storage 值 ${rowIndex + 1}`}
                          onChange={(e) => {
                            const next = rows.map((r, i) =>
                              i === rowIndex ? { ...r, valueText: e.target.value } : r,
                            )
                            updateStorageRows(ruleIndex, next)
                          }}
                        />
                      </div>
                    ))}
                    <button
                      type="button"
                      className="add-row-btn"
                      onClick={() => addStorageRow(ruleIndex, rows)}
                    >
                      + 新增 storage
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}

        <div className="rules-ui-add">
          <button type="button" className="primary" onClick={addRule}>
            + 新增规则
          </button>
        </div>
      </div>
    </div>
  )
}

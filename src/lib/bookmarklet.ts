export type StorageItem = Record<string, unknown>

export type Rule = {
  urlpattern: string
  storage: StorageItem[]
}

/** 云端规则文件（JSON 数组）；Go 书签另含完整注入 JS */
export const REPO_FILE = 'rules.json'

export const DEFAULT_RULES: Rule[] = [
  {
    urlpattern: 'github.io/Spark',
    storage: [
      { spark_repo: 'shalom-lab/Spark' },
      { spark_token: 'YOUR_TOKEN_HERE' },
    ],
  },
  {
    urlpattern: 'github.com',
    storage: [{ theme: { color: 'dark' } }],
  },
]

export const CACHE_KEYS = {
  rules: 'coder_rules_cache',
  name: 'coder_name_cache',
} as const

export function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

/** 结构校验（允许编辑中的空 urlpattern）；生成/保存前再调 assertRulesReady */
export function parseRulesJson(text: string): Rule[] {
  const data = JSON.parse(text) as unknown
  if (!Array.isArray(data)) {
    throw new Error('根节点必须是数组')
  }
  for (const item of data) {
    if (!item || typeof item !== 'object') {
      throw new Error('每条规则必须是对象')
    }
    const rule = item as Partial<Rule>
    if (typeof rule.urlpattern !== 'string') {
      throw new Error('每条规则需要 urlpattern 字符串')
    }
    if (!Array.isArray(rule.storage)) {
      throw new Error('每条规则需要 storage 数组')
    }
  }
  return data as Rule[]
}

export function assertRulesReady(rules: Rule[]): void {
  if (rules.length === 0) {
    throw new Error('至少需要一条规则')
  }
  for (const rule of rules) {
    if (!rule.urlpattern.trim()) {
      throw new Error('每条规则需要非空 urlpattern')
    }
  }
}

/** 括号匹配取出数组字面量（跳过字符串） */
function extractArrayLiteral(source: string, fromIndex: number): string | null {
  let i = fromIndex
  while (i < source.length && /\s/.test(source[i]!)) i++
  if (source[i] !== '[') return null

  let depth = 0
  let inStr: '"' | "'" | '`' | null = null
  let escape = false

  for (let j = i; j < source.length; j++) {
    const c = source[j]!
    if (inStr) {
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\') {
        escape = true
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      continue
    }
    if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') {
      depth--
      if (depth === 0) return source.slice(i, j + 1)
    }
  }
  return null
}

/** 从 bookmarklet.js 抽出 ruleList */
export function extractRulesFromJs(js: string): Rule[] | null {
  const m = js.match(/const\s+ruleList\s*=\s*/)
  if (!m || m.index === undefined) return null
  const literal = extractArrayLiteral(js, m.index + m[0].length)
  if (!literal) return null
  try {
    // JS 对象字面量（可无无引号/无引号键）→ 运行时取值
    const data = new Function(`"use strict"; return (${literal});`)() as unknown
    return parseRulesJson(JSON.stringify(data))
  } catch {
    return null
  }
}

/** 云端/本地保存的可读 JS 源文件（与现有 bookmarklet.js 同结构） */
export function buildBookmarkletFile(rules: Rule[]): string {
  const indented = JSON.stringify(rules, null, 2).replace(/\n/g, '\n  ')
  return `(function() {
  const ruleList = ${indented};

  const currentUrl = window.location.href;

  ruleList.forEach(rule => {
    if (currentUrl.includes(rule.urlpattern)) {
      rule.storage.forEach(item => {
        for (const key in item) {
          const val = item[key];
          const saveVal = (typeof val === 'object') ? JSON.stringify(val) : String(val);
          localStorage.setItem(key, saveVal);
        }
      });
      console.log('✅ Bookmarklet: 已为 ' + rule.urlpattern + ' 更新本地存储');
    }
  });
})();
`
}

export function minify(code: string): string {
  return code
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n\s+/g, '\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function toJavascriptUrl(code: string): string {
  return `javascript:${encodeURIComponent(minify(code))}`
}

export function generateFromRules(rules: Rule[]): string {
  return toJavascriptUrl(buildBookmarkletFile(rules))
}

/** 拉取/导入：JSON 数组或 bookmarklet.js 均可 */
export function rulesFromFileContent(text: string): Rule[] {
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    return parseRulesJson(trimmed)
  }
  const fromJs = extractRulesFromJs(trimmed)
  if (!fromJs) {
    throw new Error('无法解析：需要 bookmarklet.js（含 ruleList）或规则 JSON 数组')
  }
  return fromJs
}

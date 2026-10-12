export type StorageItem = Record<string, unknown>

export type Rule = {
  urlpattern: string
  storage: StorageItem[]
}

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
    if (typeof rule.urlpattern !== 'string' || !rule.urlpattern.trim()) {
      throw new Error('每条规则需要非空 urlpattern')
    }
    if (!Array.isArray(rule.storage)) {
      throw new Error('每条规则需要 storage 数组')
    }
  }
  return data as Rule[]
}

/** 从旧版 bookmarklet JS 里尽量抽出 ruleList */
export function extractRulesFromJs(js: string): Rule[] | null {
  const match = js.match(/const\s+ruleList\s*=\s*(\[[\s\S]*?\]);/)
  if (!match) return null
  try {
    // 宽松：把近似 JSON 的 JS 对象字面量转成 JSON
    const raw = match[1]
      .replace(/(\w+)\s*:/g, '"$1":')
      .replace(/'/g, '"')
    return parseRulesJson(raw)
  } catch {
    return null
  }
}

export function buildBookmarkletSource(rules: Rule[]): string {
  const rulesLiteral = JSON.stringify(rules)
  return `(function(){const ruleList=${rulesLiteral};const currentUrl=window.location.href;ruleList.forEach(function(rule){if(currentUrl.includes(rule.urlpattern)){rule.storage.forEach(function(item){for(var key in item){var val=item[key];var saveVal=(typeof val==="object")?JSON.stringify(val):String(val);localStorage.setItem(key,saveVal);}});console.log("✅ Bookmarklet: 已为 "+rule.urlpattern+" 更新本地存储");}});})();`
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
  return toJavascriptUrl(buildBookmarkletSource(rules))
}

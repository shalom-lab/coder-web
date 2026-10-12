/** BYOK：扁平 localStorage 键，启动时静默读取 */

export const APP = 'coder' as const

export const BYOK_KEYS = {
  repo: `gh-${APP}-repo`,
  token: `gh-${APP}-token`,
} as const

export type ByokSettings = {
  repo: string
  token: string
}

export function readByok(): ByokSettings {
  return {
    repo: localStorage.getItem(BYOK_KEYS.repo) ?? '',
    token: localStorage.getItem(BYOK_KEYS.token) ?? '',
  }
}

export function saveByok(settings: ByokSettings): void {
  const repo = settings.repo.trim()
  const token = settings.token.trim()
  if (repo) localStorage.setItem(BYOK_KEYS.repo, repo)
  else localStorage.removeItem(BYOK_KEYS.repo)
  if (token) localStorage.setItem(BYOK_KEYS.token, token)
  else localStorage.removeItem(BYOK_KEYS.token)
}

export function clearByok(): void {
  localStorage.removeItem(BYOK_KEYS.repo)
  localStorage.removeItem(BYOK_KEYS.token)
}

export function maskSecret(value: string): string {
  if (!value) return ''
  if (value.length <= 4) return '****'
  return `${'•'.repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`
}

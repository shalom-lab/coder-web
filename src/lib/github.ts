import type { ByokSettings } from './byok'

const API = 'https://api.github.com'

function headers(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.trim().split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('仓库格式应为 owner/name')
  }
  return { owner: parts[0], name: parts[1] }
}

function pathUrl(owner: string, name: string, path: string): string {
  const encoded = path
    .split('/')
    .map((p) => encodeURIComponent(p))
    .join('/')
  return `${API}/repos/${owner}/${name}/contents/${encoded}`
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary)
}

export async function fetchRepoFile(
  settings: ByokSettings,
  path: string,
): Promise<{ content: string; sha: string }> {
  if (!settings.repo || !settings.token) {
    throw new Error('请先在设置中填写仓库与 Token')
  }
  const { owner, name } = parseRepo(settings.repo)
  const res = await fetch(pathUrl(owner, name, path), {
    headers: headers(settings.token),
  })
  if (res.status === 401 || res.status === 403) {
    throw new Error('GitHub 鉴权失败，请检查 Token scope 与仓库名')
  }
  if (res.status === 404) {
    throw new Error(`仓库中未找到文件：${path}`)
  }
  if (!res.ok) {
    throw new Error(`拉取失败（${res.status}）`)
  }
  const data = (await res.json()) as {
    content?: string
    encoding?: string
    sha?: string
  }
  if (!data.content || data.encoding !== 'base64' || !data.sha) {
    throw new Error('返回内容无效')
  }
  return { content: decodeBase64Utf8(data.content), sha: data.sha }
}

export async function putRepoFile(
  settings: ByokSettings,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> {
  if (!settings.repo || !settings.token) {
    throw new Error('请先在设置中填写仓库与 Token')
  }
  const { owner, name } = parseRepo(settings.repo)
  const body: Record<string, string> = {
    message,
    content: encodeBase64Utf8(content),
  }
  if (sha) body.sha = sha

  const res = await fetch(pathUrl(owner, name, path), {
    method: 'PUT',
    headers: { ...headers(settings.token), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 401) {
    throw new Error('Token 无效或已过期，请到设置里更新')
  }
  if (res.status === 403) {
    throw new Error('Token 无写权限，需 contents:write（或 classic 的 repo 权限）')
  }
  if (res.status === 404) {
    throw new Error(
      `找不到仓库或无权访问：${settings.repo}（请确认设置里是 owner/name，且 Token 已授权该仓库）`,
    )
  }
  if (res.status === 409 || res.status === 422) {
    throw new Error('文件冲突或 sha 过期，请先点「拉取」再保存')
  }
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`推送失败（${res.status}）：${err.slice(0, 120)}`)
  }
}

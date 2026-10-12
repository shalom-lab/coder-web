# coder-web

Bookmarklet 规则编辑器（React + Vite）。用美化后的 JSON 编辑 `ruleList`，一键压缩为可拖拽的 `javascript:` 书签。

## 功能

- Monaco 编辑 **规则 JSON**（缩进、换行、括号高亮、格式化）
- 压缩并复制 bookmarklet；拖拽链接到书签栏
- **保存到云端**：写入 BYOK 仓库根目录的 `rules.json`（需 `gh-coder-repo` + `gh-coder-token`）
- 拉取 / 本地导入 / 导出
- 兼容从旧版 `.js`（含 `ruleList`）导入

## BYOK（localStorage）

密钥只存本机，可 Settings 填写，也可事先写入 `localStorage`；启动会自动读。

| 键名 | 含义 |
|------|------|
| `gh-coder-repo` | GitHub 仓库，格式 `owner/name` |
| `gh-coder-token` | GitHub PAT（BYOK） |

配置后可用 **拉取 / 保存到云端** 同步仓库根目录的 `rules.json`。

```js
localStorage.setItem('gh-coder-repo', 'owner/name')
localStorage.setItem('gh-coder-token', 'ghp_xxx')
```

## 在线地址

https://shalom-lab.github.io/coder-web/

Pages 源：GitHub Actions（推送 `main`/`master` 自动构建部署）。

## 开发

```bash
npm install
npm run dev
```

## 规则 JSON 示例

```json
[
  {
    "urlpattern": "github.io/Spark",
    "storage": [
      { "spark_repo": "shalom-lab/Spark" },
      { "spark_token": "YOUR_TOKEN_HERE" }
    ]
  }
]
```

匹配当前 URL 后，bookmarklet 会把 `storage` 写入页面的 `localStorage`。

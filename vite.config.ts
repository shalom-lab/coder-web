import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/** GitHub Pages 无服务端 rewrite：复制 index → 404 以支持刷新/深链 */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    closeBundle() {
      const dist = resolve(import.meta.dirname, 'dist')
      const index = resolve(dist, 'index.html')
      if (!existsSync(index)) return
      copyFileSync(index, resolve(dist, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/coder-web/',
  plugins: [react(), spaFallback()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})

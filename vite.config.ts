import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 构建结束后，把 dist 里的带 hash 的资源清单塞进 sw.js，
 * 这样 Service Worker 安装时就能一次性缓存整套前端，离线打开才真的可用。
 */
function swPrecache(): Plugin {
  return {
    name: 'sw-precache',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve('dist')
      const assetsDir = path.join(dist, 'assets')
      const assets = fs.existsSync(assetsDir)
        ? fs
            .readdirSync(assetsDir)
            .filter((f) => /\.(js|css|woff2?|png|svg|webp)$/.test(f))
            .map((f) => `./assets/${f}`)
        : []
      const swPath = path.join(dist, 'sw.js')
      if (!fs.existsSync(swPath)) return
      const src = fs.readFileSync(swPath, 'utf8')
      fs.writeFileSync(swPath, src.replace('/* __ASSETS__ */ []', JSON.stringify(assets)))
    },
  }
}

export default defineConfig({
  // 相对路径，便于部署到 GitHub Pages 这类子路径下
  base: './',
  plugins: [react(), swPrecache()],
  server: { port: 5173, strictPort: false },
})

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 构建结束后，把 dist 里的带 hash 的资源清单和构建 hash 塞进 sw.js：
 * - 资源清单：Service Worker 安装时一次性缓存整套前端，离线打开才真的可用
 * - 构建 hash：缓存名变成 practice-xxxxxxxx，新版本激活时旧的整个删掉，
 *   不会让历史版本的 hash 资源一直占地方
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

      const indexHtml = path.join(dist, 'index.html')
      const buildId = crypto
        .createHash('sha1')
        .update(assets.join('|'))
        .update(fs.existsSync(indexHtml) ? fs.readFileSync(indexHtml, 'utf8') : '')
        .digest('hex')
        .slice(0, 8)

      let src = fs.readFileSync(swPath, 'utf8')
      src = src.replace('/* __ASSETS__ */ []', JSON.stringify(assets))
      src = src.replace("/* __CACHE__ */ 'practice-dev'", JSON.stringify(`practice-${buildId}`))
      if (src.includes('__ASSETS__') || src.includes('__CACHE__')) {
        throw new Error('sw.js 里的占位符没被替换，检查 public/sw.js 是否被改动')
      }
      fs.writeFileSync(swPath, src)
    },
  }
}

export default defineConfig({
  // 相对路径，便于部署到 GitHub Pages 这类子路径下
  base: './',
  plugins: [react(), swPrecache()],
  server: {
    port: 5173,
    strictPort: false,
    // Windows 下某些工具会在仓库里生成临时目录，被监听会偶发 EBUSY 把 dev server 弄崩
    watch: { ignored: ['**/*.tmpdir/**', '**/.~*'] },
  },
})

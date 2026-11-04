import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// PWA：只在正式构建里注册，开发服务器不注册，免得改了代码却被缓存挡住
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // 注册失败不影响正常使用，只是没有离线能力
    })
  })

  // 新版本接管：不自动刷新（可能正在做题），只在底部给一条可以点掉的提示
  const hadController = Boolean(navigator.serviceWorker.controller)
  let prompting = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || prompting) return
    prompting = true
    showUpdateBar()
  })
}

function showUpdateBar() {
  if (document.getElementById('sw-update')) return

  const bar = document.createElement('div')
  bar.id = 'sw-update'
  bar.className = 'update-bar'
  bar.innerHTML = `
    <span class="update-text">有新版本了，刷新后生效</span>
    <button type="button" class="btn primary sm" data-act="reload">刷新</button>
    <button type="button" class="update-close" aria-label="稍后再说" data-act="close">×</button>
  `
  document.body.appendChild(bar)

  bar.addEventListener('click', (event) => {
    const act = (event.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act')
    if (act === 'reload') {
      location.reload()
    } else if (act === 'close') {
      bar.remove()
    }
  })
}

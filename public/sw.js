/* 极简离线缓存：壳页面走网络优先，静态资源走缓存优先（Vite 产物文件名带 hash，不会串版本） */
// 构建时由 vite 插件替换成带构建 hash 的名字，例如 practice-1a2b3c4d
const CACHE = /* __CACHE__ */ 'practice-dev'
// 构建时由 vite 插件填入带 hash 的 JS/CSS 清单
const ASSETS = /* __ASSETS__ */ []

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  ...ASSETS,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // 逐个缓存：单个资源 404 不该让整个 Service Worker 装不上
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            /* 忽略单个失败，运行时再补 */
          }),
        ),
      )
      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // 页面导航：优先拿最新的，断网时回退到缓存的壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy))
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // 其他资源：先看缓存，没有再走网络并写入缓存
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((cache) => cache.put(req, copy))
          }
          return res
        }),
    ),
  )
})

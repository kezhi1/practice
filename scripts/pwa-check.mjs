import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:4173'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1360, height: 1000 })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

try {
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.topbar', { timeout: 8000 })

  const manifest = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute('href'))
  const manifestRes = await page.evaluate(async (href) => {
    const res = await fetch(href)
    const json = await res.json()
    return { ok: res.ok, name: json.name, icons: json.icons.length, start: json.start_url }
  }, manifest)

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return { scope: reg.scope, active: !!reg.active }
  })

  // 给 Service Worker 一点时间把资源写进缓存
  await new Promise((r) => setTimeout(r, 1200))
  const cacheKeys = await page.evaluate(async () => {
    const names = await caches.keys()
    const cache = await caches.open(names[0])
    const keys = await cache.keys()
    return { names, count: keys.length, sample: keys.slice(0, 4).map((k) => new URL(k.url).pathname) }
  })

  // 清掉浏览器 HTTP 缓存，确保离线时只有 Service Worker 的缓存可用
  const client = await page.createCDPSession()
  await client.send('Network.clearBrowserCache')

  // 断网后重新打开，应该还能用
  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 8000 })
  const offlineTitle = await page.$eval('.brand', (el) => el.textContent.trim())
  await page.screenshot({ path: 'docs/shots/19-offline.png' })

  console.log(JSON.stringify({ ok: true, manifest, manifestRes, sw, cacheKeys, offlineTitle, errors }, null, 2))
} catch (e) {
  console.error('FAILED:', e.message)
  console.error(JSON.stringify({ errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}

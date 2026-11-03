import puppeteer from 'puppeteer-core'

const BASE = process.env.BASE_URL ?? 'http://localhost:8899/practice/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1360, height: 900 })

const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

try {
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.waitForSelector('.topbar', { timeout: 8000 })

  const manifestHref = await page.$eval('link[rel="manifest"]', (el) => el.getAttribute('href'))

  const sw = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return { scope: reg.scope, script: reg.active?.scriptURL }
  })

  await new Promise((r) => setTimeout(r, 1200))
  const cache = await page.evaluate(async () => {
    const names = await caches.keys()
    const c = await caches.open(names[0])
    const keys = await c.keys()
    return { names, count: keys.length, sample: keys.slice(0, 5).map((k) => new URL(k.url).pathname) }
  })

  await page.setOfflineMode(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.topbar', { timeout: 8000 })
  const offlineOk = await page.$eval('.brand', (el) => el.textContent.trim())

  console.log(
    JSON.stringify({ ok: true, manifestHref, sw, cache, offlineOk, errors }, null, 2),
  )
} catch (e) {
  console.error('FAILED:', e.message)
  console.error(JSON.stringify({ errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}

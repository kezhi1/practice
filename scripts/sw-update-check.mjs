/**
 * 验证 PWA 的“发布新版本”路径：
 * 1. 打开正式构建（npm run preview），确认当前缓存名是 practice-<buildId>
 * 2. 模拟一次新发布：把 dist/sw.js 的缓存名改掉（等价于新构建）
 * 3. 触发 Service Worker 更新，检查旧缓存被删、新缓存接管
 *
 * 需要先 npm run build && npm run preview（默认 4173）。
 * 脚本结束会把 dist/sw.js 还原。
 */
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.BASE_URL ?? 'http://localhost:4173/'
const SW_PATH = path.resolve('dist/sw.js')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!fs.existsSync(SW_PATH)) {
  console.error('没有找到 dist/sw.js，先跑 npm run build')
  process.exit(1)
}

const original = fs.readFileSync(SW_PATH, 'utf8')
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

try {
  await page.goto(BASE, { waitUntil: 'networkidle2' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await sleep(800)

  const before = await page.evaluate(() => caches.keys())
  const current = before[0] ?? ''
  if (!/^practice-[0-9a-f]{8}$/.test(current)) {
    throw new Error(`缓存名不是 practice-<buildId>：${before.join(', ')}`)
  }

  // 模拟新版本：改缓存名 + 让脚本内容变化（浏览器按字节判断是否有更新）
  const bumped = original
    .replace(/const CACHE = "practice-[0-9a-f]{8}"/, 'const CACHE = "practice-0000dead"')
    .replace('/* 极简离线缓存', '/* 极简离线缓存（模拟新版本）')
  if (!bumped.includes('practice-0000dead')) throw new Error('没能改写 dist/sw.js，构建格式变了？')
  fs.writeFileSync(SW_PATH, bumped)

  const update = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    let changed = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      changed = true
    })
    await reg.update()
    await new Promise((r) => setTimeout(r, 3000))
    return { changed, keys: await caches.keys() }
  })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await sleep(1000)
  const after = await page.evaluate(() => caches.keys())

  const ok =
    update.changed &&
    update.keys.length === 1 &&
    update.keys[0] === 'practice-0000dead' &&
    after.length === 1 &&
    after[0] === 'practice-0000dead' &&
    !before.includes('practice-0000dead')

  console.log(
    JSON.stringify({ ok, before, during: update.keys, after, controllerchange: update.changed, errors }, null, 2),
  )
  if (!ok) throw new Error('新版本没有正确接管缓存')
  if (errors.length) throw new Error(`页面报错：${errors.join('; ')}`)
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  fs.writeFileSync(SW_PATH, original)
  await browser.close()
}

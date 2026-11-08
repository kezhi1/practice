import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5173'

const sample = `## 计算机网络基础

## 1. TCP 是面向连接的可靠传输协议。
- A. 正确
- B. 错误
> 答案：A
> 解析：TCP 通过三次握手、确认重传保证可靠。

## 2. 路由器工作在 OSI 模型的哪一层？
- A. 物理层
- B. 网络层
- C. 应用层
- D. 传输层
> 答案：B

## 3. 下列哪些属于传输层协议？
- A. TCP
- B. UDP
- C. HTTP
- D. ICMP
> 答案：AB

## 4. 一加一等于几？
- A. 1
- B. 2
- C. 3
> 答案：B

## 5. 下列哪些水果？
- A. 苹果
- B. 香蕉
- C. 白菜
> 答案：AB

## 6. 地球是圆的。
- A. 正确
- B. 错误
> 答案：A
`

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
})

const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function overflowReport() {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const doc = document.documentElement.scrollWidth
    const bad = []
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.dots') || el.closest('.update-bar') || el.closest('.topbar-actions')) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      if (r.right > vw + 1) {
        const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : ''
        bad.push(
          `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''} +${Math.round(r.right - vw)}px「${(el.textContent ?? '').trim().slice(0, 20)}」`,
        )
      }
      if (bad.length >= 6) break
    }
    return { vw, scrollWidth: doc, overflow: [...new Set(bad)] }
  })
}

async function shot(name) {
  await sleep(350)
  const rep = await overflowReport()
  console.log(name.padEnd(18), `scrollW=${rep.scrollWidth}`, rep.overflow.length ? rep.overflow : 'ok')
  await page.screenshot({ path: `docs/shots/m-${name}.png` })
}

await page.goto(BASE, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')]
    .find((b) => b.textContent.includes('导入文件'))
    ?.click()
})
await page.waitForSelector('textarea')
await page.evaluate((md) => {
  const ta = document.querySelector('textarea')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
  setter?.call(ta, md)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}, sample)
await sleep(500)
await shot('01-import')

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('导入 '))?.click()
})
await sleep(700)
await shot('02-bank-detail')

await page.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
await shot('03-banks')

const bankId = await page.evaluate(() => {
  const a = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))
  a?.click()
  return null
})
await sleep(700)
await shot('04-quiz')

await page.evaluate(() => {
  ;[...document.querySelectorAll('.option')][1]?.click()
})
await sleep(200)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '交卷')?.click()
})
await sleep(300)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '直接交卷')?.click()
})
await sleep(800)
await shot('05-result')

await page.goto(`${BASE}/#/wrong`, { waitUntil: 'networkidle0' })
await shot('06-wrong')

await page.goto(`${BASE}/#/review`, { waitUntil: 'networkidle0' })
await shot('07-review')

await page.goto(`${BASE}/#/history`, { waitUntil: 'networkidle0' })
await shot('08-history')

await page.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
await page.setViewport({ width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await sleep(300)
await shot('09-banks-360')

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
})
await sleep(700)
await shot('10-quiz-360')

await page.setViewport({ width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await page.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
await shot('11-banks-768')
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
})
await sleep(700)
await shot('12-quiz-768')

await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await page.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
await shot('13-dark-390')

console.log('errors:', errors)
await browser.close()

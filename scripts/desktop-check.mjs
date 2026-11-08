import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5173'

const sample = `## 桌面端回归

## 1. 一加一等于几？
- A. 1
- B. 2
- C. 3
> 答案：B

## 2. 下列哪些水果？
- A. 苹果
- B. 香蕉
- C. 白菜
> 答案：AB
`

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1360, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

await page.goto(BASE, { waitUntil: 'networkidle0' })
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('导入文件'))?.click()
})
await page.waitForSelector('textarea')
await page.evaluate((md) => {
  const ta = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, md)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}, sample)
await sleep(500)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('导入 '))?.click()
})
await sleep(700)

const detail = await page.evaluate(() => {
  const topbar = document.querySelector('.topbar')
  const cs = getComputedStyle(topbar)
  const navBtns = [...document.querySelectorAll('.topbar-actions .btn')]
  const tops = new Set(navBtns.map((b) => Math.round(b.getBoundingClientRect().top)))
  const importBtn = navBtns[navBtns.length - 1]
  return {
    topbarPosition: cs.position,
    topbarHeight: Math.round(topbar.getBoundingClientRect().height),
    navRows: tops.size,
    importLabel: JSON.stringify(importBtn.textContent),
    importBtnWidth: Math.round(importBtn.getBoundingClientRect().width),
    scrollW: document.documentElement.scrollWidth,
  }
})
console.log('bank detail:', detail)
await page.screenshot({ path: 'docs/shots/d-01-bank-detail.png' })

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
})
await sleep(700)
const quiz = await page.evaluate(() => {
  const top = document.querySelector('.quiz-top')
  const rows = [...top.children].map((c) => Math.round(c.getBoundingClientRect().top))
  const kbd = document.querySelector('.kbd-hint')
  const title = top.querySelector('strong')
  return {
    quizTopRows: new Set(rows).size,
    quizTopHeight: Math.round(top.getBoundingClientRect().height),
    kbdHintDisplay: kbd ? getComputedStyle(kbd).display : 'absent',
    titleWidth: title ? Math.round(title.getBoundingClientRect().width) : 0,
    scrollW: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }
})
console.log('quiz:', quiz)
await page.screenshot({ path: 'docs/shots/d-02-quiz.png' })

await page.goto(`${BASE}/#/wrong`, { waitUntil: 'networkidle0' })
await sleep(300)
const wrong = await page.evaluate(() => {
  const row = document.querySelector('.row.between.wrap')
  const cs = row ? getComputedStyle(row) : null
  return { flexDirection: cs?.flexDirection ?? 'none', scrollW: document.documentElement.scrollWidth }
})
console.log('wrong page:', wrong)
await page.screenshot({ path: 'docs/shots/d-03-wrong.png' })

console.log('console errors:', errors)
await browser.close()

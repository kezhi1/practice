/**
 * 大题库性能自检：造一个 N 题的题库，量「打开管理页」和「搜索」的耗时。
 * 用法：node scripts/perf-check.mjs 1000
 */
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5173'
const N = Number(process.argv[2] ?? 1000)

function buildMarkdown(n) {
  const lines = ['---', 'title: 性能自检', '---', '']
  for (let i = 1; i <= n; i++) {
    lines.push(`## ${i}. 第 ${i} 题：以下关于数据结构的说法，哪一项是正确的？`)
    lines.push(`- A. 选项一 ${i}`)
    lines.push(`- B. 选项二 ${i}`)
    lines.push(`- C. 选项三 ${i}`)
    lines.push(`- D. 选项四 ${i}`)
    lines.push('> 答案：B')
    lines.push('')
  }
  return lines.join('\n')
}

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

const md = buildMarkdown(N)
const t0 = Date.now()
await page.evaluate((text) => {
  const ta = document.querySelector('textarea')
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, text)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}, md)
await page.waitForFunction(
  (n) => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('导入 '))
    return el && el.textContent.includes(String(n))
  },
  { timeout: 60000 },
  N,
)
const parseMs = Date.now() - t0

const t1 = Date.now()
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('导入 '))?.click()
})
await page.waitForSelector('.question-row', { timeout: 60000 })
const openMs = Date.now() - t1
await sleep(300)

const firstState = await page.evaluate(() => ({
  cards: document.querySelectorAll('.question-row').length,
  nodes: document.querySelectorAll('*').length,
  totalLabel: document.querySelector('.row.between .muted.small')?.textContent?.trim(),
  hasMore: !!document.querySelector('.load-more'),
}))

// 滚到底触发自动加载一批
await page.evaluate(() => {
  document.querySelector('.load-more')?.scrollIntoView({ block: 'center' })
})
await sleep(500)
const afterMore = await page.evaluate(() => document.querySelectorAll('.question-row').length)

await page.evaluate(() => window.scrollTo(0, 0))
await sleep(200)
await page.screenshot({ path: 'docs/shots/perf-bank-list.png' })

// 搜索响应
const t2 = Date.now()
const keyword = `第 ${Math.min(7, N)} 题：`
await page.evaluate((kw) => {
  const input = document.querySelector('.toolbar input, input.input')
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(input, kw)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}, keyword)
await page.waitForFunction(
  () => {
    const cards = document.querySelectorAll('.question-row')
    return cards.length > 0 && cards.length <= 3
  },
  { timeout: 15000 },
)
const searchMs = Date.now() - t2

const summary = {
  questions: N,
  parseMs,
  openMs,
  searchMs,
  firstCards: firstState.cards,
  nodes: firstState.nodes,
  totalLabel: firstState.totalLabel,
  afterLoadMore: afterMore,
  errors,
}
console.log(JSON.stringify(summary, null, 2))

const problems = []
if (firstState.cards > 60) problems.push(`首屏渲染了 ${firstState.cards} 张卡片（应 ≤60）`)
// 一万题实测 1.4s，用户确认这个量级可接受，所以超大题库放宽到 2s
const openBudget = Number(process.env.OPEN_BUDGET || (N > 6000 ? 2000 : 1200))
if (openMs > openBudget) problems.push(`打开管理页 ${openMs}ms（应 <${openBudget}ms）`)
if (afterMore <= firstState.cards) problems.push('滚动到底没有加载下一批')
if (searchMs > 800) problems.push(`搜索 ${searchMs}ms（应 <800ms）`)
if (problems.length) {
  console.log('FAILED:', problems)
  process.exitCode = 1
}
await browser.close()

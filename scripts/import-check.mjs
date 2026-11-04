import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const sloppy = `### 光速约为多少？
A、3×10^8 m/s
B、3×10^6 m/s
答案 A

### 下面哪些是数据库？
(A) Chrome
(B) MySQL
(C) Redis
【答案】BC
分析：Chrome 是浏览器

#### 水在标准大气压下的沸点是 100℃
> 答案：对
`

const numbered = `1. 下面哪个是传输层协议
A. TCP
B. HTTP
答案：A

2. 多选：以下属于浏览器内核的是
A. Blink
B. WebKit
C. MySQL
答案：AB
`

const strictBad = `## 单选题却写了两个答案
- A. 甲
- B. 乙
- C. 丙
> 答案：A,B
> 类型：单选

## 这题是好的
- A. 甲
- B. 乙
答案 A
`

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1360, height: 1000 },
})
const errors = []
let page = await browser.newPage()
page.on('pageerror', (e) => errors.push(e.message))

async function importOnce(md, name) {
  if (page.isClosed()) {
    page = await browser.newPage()
    page.on('pageerror', (e) => errors.push(e.message))
  }
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  } catch (e) {
    // 上一轮截图/导航把 frame 弄丢了：换一个页面重来
    console.log('页面失联，重开：', e.message.split(String.fromCharCode(10))[0])
    await page.close().catch(() => {})
    page = await browser.newPage()
    page.on('pageerror', (err) => errors.push(err.message))
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
  }
  const buttons = await page.$$('button')
  for (const h of buttons) {
    const t = await page.evaluate((el) => el.textContent ?? '', h)
    if (t.includes('导入 Markdown') || t.includes('导入第一个')) {
      await h.click()
      break
    }
  }
  await page.waitForSelector('textarea.editor', { timeout: 5000 })
  await page.evaluate((value) => {
    const ta = document.querySelector('textarea.editor')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, md)
  await page.evaluate(() => {
    const details = document.querySelector('details.tips')
    if (details) details.open = true
  })
  await new Promise((r) => setTimeout(r, 600))
  await page.screenshot({ path: `docs/shots/${name}.png`, fullPage: true })
  const text = await page.evaluate(() => {
    const panel = document.querySelectorAll('.card')[1]
    return (panel?.innerText ?? '').slice(0, 800)
  })
  return text
}

console.log('--- 宽容写法 ---')
console.log(await importOnce(sloppy, '11-tolerant-preview'))

// 批次 0：复制 AI 提示词按钮要真的能点、能回显
await page.waitForSelector('textarea.editor', { timeout: 5000 })
const copied = await page.evaluate(async () => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('复制 AI 提示词'),
  )
  if (!btn) return 'missing'
  btn.click()
  await new Promise((r) => setTimeout(r, 400))
  const label = [...document.querySelectorAll('button')]
    .map((b) => b.textContent ?? '')
    .find((t) => t.includes('已复制'))
  return label ? 'copied' : 'no-feedback'
})
if (copied !== 'copied') throw new Error(`复制 AI 提示词按钮异常：${copied}`)
console.log('复制 AI 提示词：', copied)

console.log('--- 无标题编号写法 ---')
console.log(await importOnce(numbered, '12-numbered-preview'))
console.log('--- examples/AI 风格题库.md（代码块外壳 + 开场白 + 答案速查表）---')
const aiFile = readFileSync(new URL('../examples/AI 风格题库.md', import.meta.url), 'utf8')
const aiText = await importOnce(aiFile, '14-ai-style')
console.log(aiText)
if (!aiText.includes('3 题可导入')) throw new Error('AI 风格样例应解析出 3 题')
if (aiText.includes('个错误')) throw new Error('AI 风格样例不应有错误')
if (aiText.includes('答案速查表')) throw new Error('答案速查表被当成题干了')

console.log('--- 严格模式下的歧义写法 ---')
console.log(await importOnce(strictBad, '13-strict-error'))

console.log('--- examples/编号式示例.md（真实文件导入）---')
const numberedFile = readFileSync(new URL('../examples/编号式示例.md', import.meta.url), 'utf8')
const numberedText = await importOnce(numberedFile, '23-numbered-file')
console.log(numberedText)
if (!numberedText.includes('5 题可导入')) throw new Error('编号式示例应解析出 5 题')
if (numberedText.includes('个错误')) throw new Error('编号式示例不应有错误')
console.log('--- examples/分节标题示例.md（## 一、单项选择题 + 编号题）---')
const sectionFile = readFileSync(new URL('../examples/分节标题示例.md', import.meta.url), 'utf8')
const sectionText = await importOnce(sectionFile, '25-section-preview')
console.log(sectionText)
if (!sectionText.includes('3 题可导入')) throw new Error('分节标题示例应解析出 3 题')
if (sectionText.includes('个错误')) throw new Error('分节标题示例不应有错误')
if (sectionText.includes('单项选择题')) throw new Error('分节标题被当成题干了')

console.log('errors', errors)
await browser.close()

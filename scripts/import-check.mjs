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

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1360, height: 1000 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

async function importOnce(md, name) {
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
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
console.log('--- 无标题编号写法 ---')
console.log(await importOnce(numbered, '12-numbered-preview'))
console.log('errors', errors)
await browser.close()

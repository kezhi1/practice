import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
// 用 localhost 而不是 127.0.0.1：Vite 默认只监听 IPv6 的 localhost，127.0.0.1 会连不上
const BASE = process.env.BASE_URL || 'http://localhost:5173'
const OUT = path.resolve('docs/shots')
fs.mkdirSync(OUT, { recursive: true })

function buildMarkdown(n = 60) {
  const lines = ['---', 'title: 计算机网络基础', 'tags: [网络, 面试]', '---', '']
  for (let i = 1; i <= n; i++) {
    if (i % 3 === 0) {
      lines.push(`## ${i}. 路由器工作在 OSI 模型的哪一层？（第 ${i} 号）`)
      lines.push('- A. 物理层', '- B. 网络层', '- C. 应用层', '- D. 传输层')
      lines.push('> 答案：B', `> 解析：第 ${i} 题解析：路由器依据 IP 地址转发，属于三层设备。`, '> 难度：2')
    } else if (i % 3 === 1) {
      lines.push(`## ${i}. 下列哪些属于传输层协议？（第 ${i} 号）`)
      lines.push('- A. TCP', '- B. UDP', '- C. HTTP', '- D. ICMP')
      lines.push('> 答案：A,B', `> 解析：第 ${i} 题解析：HTTP 是应用层，ICMP 是网络层。`, '> 类型：多选')
    } else {
      lines.push(`## ${i}. TCP 是面向连接的可靠传输协议吗？（第 ${i} 号）`)
      lines.push('- A. 正确', '- B. 错误')
      lines.push('> 答案：对', `> 解析：第 ${i} 题解析：TCP 通过三次握手、确认重传保证可靠。`, '> 类型：判断')
    }
    lines.push('')
  }
  return lines.join('\n')
}

const errors = []

async function clickText(page, text, tag = 'button') {
  const handles = await page.$$(tag)
  for (const h of handles) {
    const t = await page.evaluate((el) => el.textContent?.trim() ?? '', h)
    const visible = await page.evaluate(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed',
      h,
    )
    if (t.includes(text) && visible) {
      await h.click()
      return true
    }
  }
  throw new Error(`找不到可点击的「${text}」`)
}

// 交卷现在会先问「还有 N 题没作答」，自动化里直接确认
async function submitAndConfirm(page) {
  await clickText(page, '交卷')
  await new Promise((r) => setTimeout(r, 250))
  const modal = await page.$('.modal')
  if (modal) {
    await clickText(page, '直接交卷')
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function shot(page, name) {
  await new Promise((r) => setTimeout(r, 350))
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  console.log('shot', name)
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--window-size=1360,1000'],
  defaultViewport: { width: 1360, height: 1000 },
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('dialog', (d) => d.accept())

try {
  // 1. 首次进入 -> 空状态
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.empty-state, .grid', { timeout: 10000 })
  await shot(page, '01-empty')

  // 2. 导入页
  await clickText(page, '+ 导入文件')
  await page.waitForSelector('textarea.editor', { timeout: 5000 })
  const md = buildMarkdown(60)
  await page.evaluate((value) => {
    const ta = document.querySelector('textarea.editor')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, md)
  await page.waitForFunction(() => document.body.innerText.includes('题可导入'), { timeout: 5000 })
  await shot(page, '02-import-preview')

  // 3. 执行导入 -> 题库详情
  await clickText(page, '导入 60 题')
  await page.waitForFunction(() => document.body.innerText.includes('每次练习随机抽'), { timeout: 8000 })
  await shot(page, '03-bank-detail')

  // 4. 开始刷题
  await clickText(page, '开始刷题')
  await page.waitForSelector('.option', { timeout: 8000 })
  const firstStem = await page.$eval('.stem', (el) => el.textContent)

  // 键盘：数字键选选项、方向键切题
  await page.keyboard.press('2')
  const kbdSelected = await page.$$eval('.option.selected', (els) => els.length)
  await page.keyboard.press('ArrowRight')
  await new Promise((r) => setTimeout(r, 80))
  const kbAdvance = await page.$$eval('.dot.current', (els) => els.map((e) => e.textContent))
  if (kbdSelected !== 1) throw new Error(`键盘选选项失败：selected=${kbdSelected}`)
  if (kbAdvance[0] !== '2') throw new Error(`键盘切题失败：current=${kbAdvance}`)
  await page.keyboard.press('ArrowLeft')
  await new Promise((r) => setTimeout(r, 80))
  // 随机作答 12 题
  for (let i = 0; i < 12; i++) {
    const opts = await page.$$('.option')
    if (opts.length) await opts[i % opts.length].click()
    if (i === 5) await shot(page, '04-quiz')
    const next = await page.$('.btn.primary')
    if (i === 11) await submitAndConfirm(page)
    else await clickText(page, '下一题')
    await new Promise((r) => setTimeout(r, 60))
    void next
  }
  await page.waitForFunction(() => document.body.innerText.includes('练习结果'), { timeout: 8000 })
  await shot(page, '05-result')

  // 5. 只看错题
  const wrongBox = await page.$('.radio input[type=checkbox]')
  if (wrongBox) await wrongBox.click()
  await shot(page, '06-result-wrong-only')

  // 6. 返回知识库
  await clickText(page, '返回知识库')
  await page.waitForSelector('.bank-card', { timeout: 5000 })
  await shot(page, '07-banks')

  // 7. 错题本
  await clickText(page, '错题本')
  await page.waitForSelector('.wrong-item, .empty-state', { timeout: 8000 })
  const wrongItems = await page.$$eval('.wrong-item', (els) => els.length)
  await shot(page, '08-wrong-book')

  // 8. 错题练习：答 3 题后交卷
  if (wrongItems > 0) {
    await clickText(page, '开始错题练习')
    await page.waitForSelector('.option', { timeout: 8000 })
    for (let i = 0; i < 3; i++) {
      const opts = await page.$$('.option')
      if (opts.length) await opts[0].click()
      if (i === 2) await submitAndConfirm(page)
      else await clickText(page, '下一题')
      await new Promise((r) => setTimeout(r, 60))
    }
    await page.waitForFunction(() => document.body.innerText.includes('练习结果'), { timeout: 8000 })
    await shot(page, '09-wrong-result')
    await clickText(page, '返回错题本')
    await page.waitForSelector('.wrong-item, .empty-state', { timeout: 5000 })
    await shot(page, '10-wrong-book-after')
  }

  // 9. 练习历史
  await clickText(page, '练习历史')
  await page.waitForSelector('.history-row, .empty-state', { timeout: 8000 })
  const historyRows = await page.$$eval('.history-row', (els) => els.length)
  await shot(page, '11-history')
  if (historyRows > 0) {
    await clickText(page, '看回顾')
    await page.waitForFunction(() => document.body.innerText.includes('练习结果'), { timeout: 8000 })
    await shot(page, '12-history-replay')
    await clickText(page, '返回练习历史')
    await page.waitForSelector('.history-row', { timeout: 5000 })
  }

  const stats = await page.evaluate(() => ({
    banks: document.querySelectorAll('.bank-card').length,
    text: document.body.innerText.slice(0, 200),
  }))
  console.log(JSON.stringify({ ok: true, firstStem, kbdSelected, kbAdvance, stats, errors }, null, 2))
} catch (e) {
  console.error('E2E FAILED:', e.message)
  await shot(page, '99-failure')
  console.log(JSON.stringify({ ok: false, errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}

if (errors.length) process.exitCode = 1

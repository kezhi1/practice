// 第二阶段收尾自检：错题本按知识库练习 + 导出 Markdown
// 用法：先起 dev（或 preview），再 node scripts/p2-check.mjs
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:5173'
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BANK_A = [
  '---', 'title: 题库甲', 'tags: [自检]', '---', '',
  '## 1. 一加一等于几？', '- A. 1', '- B. 2', '- C. 3', '> 答案：B', '',
  '## 2. 下列哪些是水果？', '- A. 苹果', '- B. 香蕉', '- C. 白菜', '> 答案：AB', '',
  '## 3. 地球是圆的。', '> 答案：对', '',
  '## 4. 一天有多少小时？', '- A. 12', '- B. 24', '- C. 48', '> 答案：B', '',
  '## 5. 水的沸点是多少？', '- A. 50℃', '- B. 100℃', '> 答案：B', '',
].join('\n')

const BANK_B = [
  '---', 'title: 题库乙', '---', '',
  '## 1. 光速约为多少？', '- A. 3×10^8 m/s', '- B. 3×10^6 m/s', '> 答案：A', '',
  '## 2. 声音能在真空中传播。', '> 答案：错', '',
].join('\n')

const errors = []
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1360, height: 1000 },
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

// 拦截 createObjectURL 拿到导出文本，不真的走下载
await page.evaluateOnNewDocument(() => {
  window.__exported = []
  const orig = URL.createObjectURL.bind(URL)
  URL.createObjectURL = (blob) => {
    try { blob.text().then((t) => window.__exported.push(t)) } catch {}
    return orig(blob)
  }
})

const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

const clickText = (text) =>
  page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t))
    btn?.click()
    return Boolean(btn)
  }, text)

const clickMatch = (re) =>
  page.evaluate((src) => {
    const rx = new RegExp(src)
    const btn = [...document.querySelectorAll('button')].find((b) => rx.test(b.textContent.trim()))
    btn?.click()
    return Boolean(btn)
  }, re)

const buttonText = (text) =>
  page.evaluate(
    (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t))?.textContent,
    text,
  )

async function importBank(markdown) {
  await page.goto(`${BASE}/#/import`, { waitUntil: 'networkidle0' })
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, text)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, markdown)
  await sleep(500)
  const clicked = await clickMatch('^导入.+题$')
  if (!clicked) {
    const all = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent.trim()))
    throw new Error('没找到导入按钮，页面按钮：' + JSON.stringify(all))
  }
  await page.waitForSelector('.bank-title', { timeout: 8000 })
  await sleep(300)
  // .bank-title 里还有「重命名」按钮，取第一个文本节点
  return page.evaluate(() => document.querySelector('.bank-title')?.firstChild?.textContent?.trim())
}

async function answerWrong(count) {
  await clickText('开始刷题')
  await page.waitForSelector('.stem', { timeout: 8000 })
  for (let i = 0; i < count; i += 1) {
    await page.evaluate(() => document.querySelectorAll('.option')[0]?.click())
    await sleep(120)
    if (i < count - 1) {
      await clickText('下一题')
      await sleep(150)
    }
  }
  await clickText('交卷')
  await sleep(250)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('直接交卷'))?.click()
  })
  await sleep(400)
}

try {
  const titleA = await importBank(BANK_A)
  assert(String(titleA).startsWith('题库甲'), `题库甲标题不对：${titleA}`)
  await answerWrong(5)

  const titleB = await importBank(BANK_B)
  assert(String(titleB).startsWith('题库乙'), `题库乙标题不对：${titleB}`)
  await answerWrong(2)

  await page.goto(`${BASE}/#/wrong`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.wrong-item', { timeout: 8000 })
  const totalItems = await page.$$eval('.wrong-item', (els) => els.length)
  // 甲：5 题里 Q3「地球是圆的」选 A（对）是答对，其余 4 道错；乙：2 题里 Q2 选 A（对）答错
  assert(totalItems === 5, `错题本应有 5 道，实得 ${totalItems}`)

  const labelAll = await buttonText('开始错题练习')

  const bankIdOfB = await page.evaluate(() => {
    const select = document.querySelector('select')
    const opt = [...select.options].find((o) => o.textContent?.includes('题库乙'))
    return opt?.value ?? null
  })
  assert(bankIdOfB, '筛选下拉里应有题库乙')

  await page.evaluate((v) => {
    const select = document.querySelector('select')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
    setter.call(select, v)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }, bankIdOfB)
  await sleep(400)
  const labelB = await buttonText('开始错题练习')
  assert(String(labelB).includes('1 题'), `选中题库乙后应只有 1 题可练，实得「${labelB}」`)

  await clickText('开始错题练习')
  await page.waitForSelector('.stem', { timeout: 8000 })
  const quizHash = await page.evaluate(() => location.hash)
  const quizTitle = await page.$eval('.quiz-top', (el) => el.textContent ?? '').catch(() => '')
  const dotCount = await page.$$eval('.dots .dot', (els) => els.length)
  assert(quizHash.startsWith('#/quiz/wrong:'), `按库练习 hash 应为 #/quiz/wrong:<id>，实得 ${quizHash}`)
  assert(quizTitle.includes('错题练习') && quizTitle.includes('题库乙'), `标题不对：${quizTitle}`)
  assert(dotCount === 1, `题库乙只有 1 道错题，实得 ${dotCount}`)
  await page.screenshot({ path: 'docs/shots/p2-wrong-scoped.png' })

  await page.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.bank-card')].find((c) => c.textContent.includes('题库甲'))
    const btn = [...card.querySelectorAll('button')].find((b) => b.textContent.trim() === '管理')
    btn?.click()
  })
  await page.waitForSelector('.bank-title', { timeout: 8000 })
  await clickText('导出 .md')
  await sleep(800)
  const exported = await page.evaluate(() => window.__exported?.[0] ?? '')
  const headings = (exported.match(/^## /gm) ?? []).length
  assert(exported.includes('title: 题库甲'), '导出应带题库标题')
  assert(headings === 5, `导出应有 5 道题，实得 ${headings}`)
  assert(exported.includes('> 答案：'), '导出应含答案行')
  fs.writeFileSync('docs/shots/p2-export-sample.md', exported)
  await page.screenshot({ path: 'docs/shots/p2-export.png' })

  console.log(JSON.stringify({ ok: true, totalWrong: totalItems, labelAll, labelScopedB: labelB, quizHash, dotCount, exportedHeadings: headings, errors }, null, 2))
} catch (e) {
  await page.screenshot({ path: 'docs/shots/99-failure.png' })
  console.error('FAILED:', e.message)
  console.error('errors:', errors)
  process.exitCode = 1
} finally {
  await browser.close()
}

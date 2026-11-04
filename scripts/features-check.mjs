import puppeteer from 'puppeteer-core'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const sample = `---
title: 功能自检
tags: [自检]
---

## 1. 一键修复用哪个键？

- A. 甲
- B. 乙
- C. 丙

> 答案：B
> 解析：就是乙。
> 难度：1

## 2. 下列哪些是水果？

- A. 苹果
- B. 香蕉
- C. 白菜

> 答案：AB
> 解析：白菜是蔬菜。
> 难度：2

## 3. 地球是圆的。

> 答案：对
> 解析：近似球体。
> 难度：1
`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })

  console.log('step: import page')
  await page.click('.topbar .btn.primary')
  await page.waitForSelector('textarea.editor', { timeout: 5000 })
  await page.evaluate((value) => {
    const ta = document.querySelector('textarea.editor')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, sample)
  await page.waitForFunction(() => document.body.innerText.includes('题可导入'), { timeout: 5000 })
  console.log('step: click import')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')]
      .find((b) => /^导入 \d+ 题$/.test(b.textContent.trim()))
      ?.click()
  })
  await page.waitForFunction(() => document.body.innerText.includes('每次练习随机抽'), {
    timeout: 8000,
  })
  await sleep(300)

  // 重命名知识库
  console.log('step: rename bank')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '重命名')?.click()
  })
  await page.waitForSelector('.rename-input', { timeout: 5000 })
  await page.evaluate(() => {
    const el = document.querySelector('.rename-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, '功能自检（改名）')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.keyboard.press('Enter')
  await sleep(500)
  const renamed = await page.$eval('.bank-title', (el) => el.textContent)
  if (!renamed.includes('功能自检（改名）')) throw new Error(`重命名没生效：${renamed}`)
  await page.screenshot({ path: 'docs/shots/20-rename.png' })

  // 回到知识库列表，检查抽题策略选择器
  console.log('step: banks page draw mode')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.topbar button')]
      .find((b) => b.textContent.trim() === '知识库')
      ?.click()
  })
  await page.waitForSelector('.bank-card', { timeout: 8000 })
  const modes = await page.$$eval('.segmented.small button', (els) => els.map((e) => e.textContent))
  if (modes.length !== 3) throw new Error(`抽题策略按钮数不对：${modes}`)
  await page.screenshot({ path: 'docs/shots/13-draw-mode.png' })

  // 卡片上也能重命名（这里按 Esc 取消，只验入口）
  console.log('step: rename on card')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.bank-card button')]
      .find((b) => b.textContent.trim() === '重命名')
      ?.click()
  })
  await page.waitForSelector('.rename-input-sm', { timeout: 5000 })
  await page.screenshot({ path: 'docs/shots/21-rename-card.png' })
  await page.keyboard.press('Escape')
  await sleep(200)
  const stillRenamed = await page.evaluate(() => {
    const el = document.querySelector('.bank-card h3')
    return document.querySelector('.rename-input-sm') === null && el?.textContent === '功能自检（改名）'
  })
  if (!stillRenamed) throw new Error('卡片重命名取消后状态不对')

  console.log('step: start quiz')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
  })
  await page.waitForSelector('.option', { timeout: 8000 })

  console.log('step: practice mode reveal')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.segmented.small button')]
      .find((b) => b.textContent === '练习模式')
      ?.click()
  })
  await sleep(150)
  await page.click('.option')
  const typeLabel = await page.$eval('.q-head .badge', (el) => el.textContent ?? '')
  if (typeLabel.includes('多选')) {
    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '对答案')?.click()
    })
  }
  await page.waitForSelector('.reveal', { timeout: 4000 })
  const revealClass = await page.$eval('.reveal', (el) => el.className)
  const correctCount = await page.$$eval('.option.correct', (els) => els.length)
  // 抽题是随机的，第一题可能是多选（AB 两个正确项），按题型判断
  const expected = typeLabel.includes('多选') ? 2 : 1
  if (correctCount !== expected) throw new Error(`练习模式标出的正确项数量不对：${correctCount}（${typeLabel}）`)
  await page.screenshot({ path: 'docs/shots/14-practice-mode.png' })

  console.log('step: draft restore')
  await page.keyboard.press('Enter')
  await sleep(120)
  await page.keyboard.press('1')
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle2' })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
  })
  await page.waitForSelector('.restore-bar', { timeout: 8000 })
  const restoredText = await page.$eval('.restore-bar', (el) => el.textContent.trim())
  const doneDots = await page.$$eval('.dot.done', (els) => els.length)
  if (doneDots < 2) throw new Error(`草稿没有恢复作答：done=${doneDots}`)
  await page.screenshot({ path: 'docs/shots/15-restore-draft.png' })

  // 收藏当前题
  console.log('step: favorite')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.q-head button')]
      .find((b) => b.textContent.includes('收藏'))
      ?.click()
  })
  await sleep(300)
  const favOn = await page.$$eval('.q-head .fav-on', (els) => els.length)
  if (favOn !== 1) throw new Error(`收藏没有生效：${favOn}`)

  console.log('step: submit clears draft')
  page.on('dialog', (d) => d.accept())
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '交卷')?.click()
  })
  await sleep(400)
  // 有新弹窗：还有未答题时先确认，再继续
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('直接交卷'))?.click()
  })
  await sleep(800)
  const draftGone = await page.evaluate(
    () =>
      new Promise((res) => {
        const req = indexedDB.open('practice-quiz')
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('drafts')) return res('no-store')
          const tx = db.transaction('drafts').objectStore('drafts').count()
          tx.onsuccess = () => res(tx.result)
        }
        req.onerror = () => res('open-error')
      }),
  )

  console.log('step: rename after submit updates history')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '知识库')?.click()
  })
  await page.waitForSelector('.bank-card', { timeout: 8000 })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '管理')?.click()
  })
  await page.waitForSelector('.rename-btn', { timeout: 8000 })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '重命名')?.click()
  })
  await page.waitForSelector('.rename-input', { timeout: 5000 })
  await page.evaluate(() => {
    const el = document.querySelector('.rename-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, '功能自检（再改）')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.keyboard.press('Enter')
  await sleep(500)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.trim() === '练习历史')?.click()
  })
  await page.waitForSelector('.history-list', { timeout: 8000 })
  const historyText = await page.evaluate(() => document.body.innerText)
  if (!historyText.includes('功能自检（再改）')) throw new Error('重命名后练习历史仍显示旧名字')

  console.log('step: review page')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.startsWith('复习'))?.click()
  })
  await page.waitForSelector('.stats', { timeout: 8000 })
  const reviewStats = await page.$$eval('.stats .stat strong', (els) => els.map((e) => e.textContent))
  const favRows = await page.$$eval('.question-row', (els) => els.length)
  if (favRows < 1) throw new Error('复习页没有列出收藏的题')
  await page.screenshot({ path: 'docs/shots/16-review.png' })

  // 把 dueAt 改成过去，模拟「到点了」
  console.log('step: force due')
  await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const req = indexedDB.open('practice-quiz')
        req.onsuccess = () => {
          const db = req.result
          const tx = db.transaction('questions', 'readwrite')
          const store = tx.objectStore('questions')
          const all = store.getAll()
          all.onsuccess = () => {
            for (const q of all.result) {
              q.dueAt = Date.now() - 1000
              store.put(q)
            }
          }
          tx.oncomplete = () => res(0)
          tx.onerror = () => rej(tx.error)
        }
        req.onerror = () => rej(req.error)
      }),
  )
  await page.reload({ waitUntil: 'networkidle2' })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.topbar button')].find((b) => b.textContent.startsWith('复习'))?.click()
  })
  await page.waitForSelector('.stats', { timeout: 8000 })
  await sleep(200)
  const dueAfter = await page.$eval('.stats .stat strong', (el) => el.textContent)
  if (Number(dueAfter) < 3) throw new Error(`到点题数不对：${dueAfter}`)
  await page.screenshot({ path: 'docs/shots/17-review-due.png' })

  console.log('step: start review quiz')
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始复习'))?.click()
  })
  await page.waitForSelector('.option', { timeout: 8000 })
  const reviewTitle = await page.$eval('.quiz-top strong', (el) => el.textContent)
  if (reviewTitle !== '今日复习') throw new Error(`复习标题不对：${reviewTitle}`)
  await page.screenshot({ path: 'docs/shots/18-review-quiz.png' })

  console.log(
    JSON.stringify(
      {
        ok: true,
        modes,
        revealClass,
        correctCount,
        restoredText,
        doneDots,
        draftGone,
        favOn,
        reviewStats,
        favRows,
        dueAfter,
        reviewTitle,
        errors,
      },
      null,
      2,
    ),
  )
} catch (e) {
  await page.screenshot({ path: 'docs/shots/99-failure.png' })
  console.error('FAILED:', e.message)
  console.error(JSON.stringify({ errors }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}

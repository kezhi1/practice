/**
 * 第四批体验项自检：
 * 1. 未作答时交卷要先确认，并能跳到第一道未答
 * 2. 答题卡区分 已答 / 未答 / 答错 / 标记
 * 3. 字号三档，刷新后保持
 * 4. hash 路由：深链接、刷新、前进后退
 */
import puppeteer from 'puppeteer-core'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

const sample = `---
title: 体验自检
tags: [自检]
---

## 1. 一加一等于几？

- A. 1
- B. 2
- C. 3

> 答案：B
> 解析：不用解释吧。

## 2. 下列哪些是水果？

- A. 苹果
- B. 香蕉
- C. 白菜

> 答案：AB

## 3. 地球是圆的。

> 答案：对

## 4. 水的化学式是什么？

- A. H2O
- B. CO2
- C. O2

> 答案：A

## 5. 一天有多少小时？

- A. 12
- B. 24
- C. 48

> 答案：B
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

const fail = (msg) => {
  throw new Error(msg)
}

try {
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })

  // ---------- 导入 ----------
  await page.click('.topbar .btn.primary')
  await page.waitForSelector('textarea.editor', { timeout: 5000 })
  await page.evaluate((value) => {
    const ta = document.querySelector('textarea.editor')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, sample)
  await page.waitForFunction(() => document.body.innerText.includes('题可导入'), { timeout: 5000 })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')]
      .find((b) => /^导入 \d+ 题$/.test(b.textContent.trim()))
      ?.click()
  })
  await page.waitForFunction(() => location.hash.startsWith('#/bank/'), { timeout: 8000 })
  const bankHash = await page.evaluate(() => location.hash)
  console.log('hash after import:', bankHash)

  // ---------- 4. 深链接 + 刷新 ----------
  await page.evaluate(() => {
    location.hash = '#/history'
  })
  await page.waitForFunction(() => document.body.innerText.includes('练习历史'), { timeout: 5000 })
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(600)
  const onHistoryAfterReload = await page.evaluate(
    () => location.hash === '#/history' && document.body.innerText.includes('练习历史'),
  )
  if (!onHistoryAfterReload) fail('刷新后没有停在 #/history')

  await page.goto(`${BASE_URL}/${bankHash}`, { waitUntil: 'networkidle2' })
  await sleep(600)
  const onBankAfterLink = await page.evaluate(
    () => location.hash.startsWith('#/bank/') && document.body.innerText.includes('体验自检'),
  )
  if (!onBankAfterLink) fail('直接打开 #/bank/<id> 没有落到题库页')

  // ---------- 开始答题 ----------
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '开始刷题')?.click()
  })
  await page.waitForSelector('.question-card', { timeout: 8000 })
  await sleep(300)
  const quizHash = await page.evaluate(() => location.hash)
  if (!quizHash.startsWith('#/quiz/bank:')) fail(`刷题页 hash 不对：${quizHash}`)
  console.log('hash on quiz:', quizHash)

  // 答第 1 题（正确），再标记它
  await page.evaluate(() => document.querySelectorAll('.option')[1]?.click())
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.q-head button')]
      .find((b) => b.textContent.includes('标记'))
      ?.click()
  })
  await sleep(200)
  const dotStates = await page.evaluate(() => {
    const dots = [...document.querySelectorAll('.dot')]
    return {
      total: dots.length,
      done: dots.filter((d) => d.classList.contains('done')).length,
      blank: dots.filter((d) => d.classList.contains('blank')).length,
      flagged: dots.filter((d) => d.classList.contains('flag')).length,
      legend: document.querySelector('.dot-legend')?.innerText.replace(/\s+/g, ' ') ?? '',
    }
  })
  console.log('dots:', dotStates)
  if (dotStates.done !== 1 || dotStates.blank !== dotStates.total - 1 || dotStates.flagged !== 1) {
    fail(`答题卡状态不对：${JSON.stringify(dotStates)}`)
  }
  if (!dotStates.legend.includes('已答') || !dotStates.legend.includes('未答')) {
    fail('答题卡图例没渲染')
  }

  // 练习模式下「答错」也进答题卡
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.segmented.small button')]
      .find((b) => b.textContent.trim() === '练习模式')
      ?.click()
  })
  await sleep(150)
  // 多选要点「对答案」才揭晓，测试挑一道单选/判断
  let picked = -1
  for (let i = 0; i < 5; i++) {
    await page.evaluate((n) => {
      ;[...document.querySelectorAll('.dot')][n]?.click()
    }, i)
    await sleep(160)
    const type = await page.evaluate(
      () => document.querySelector('.q-head .badge')?.textContent?.trim() ?? '',
    )
    if (type !== '多选') {
      picked = i
      break
    }
  }
  if (picked < 0) fail('样本里没有单选/判断题')
  // 随机抽题下不知道该选哪个是错的：挨个点，直到练习模式揭晓「答错了」
  for (let i = 0; i < 3; i++) {
    await page.evaluate((n) => {
      document.querySelectorAll('.option')[n]?.click()
    }, i)
    await sleep(150)
    const bad = await page.evaluate(() => document.querySelector('.reveal.bad') !== null)
    if (bad) break
  }
  await sleep(150)
  const wrongDot = await page.evaluate(() => ({
    classes: [...document.querySelectorAll('.dot')].map((d) => d.className),
    wrong: document.querySelectorAll('.dot.wrong').length,
    legend: document.querySelector('.dot-legend')?.innerText.includes('答错') ?? false,
    revealed: document.querySelector('.reveal') !== null,
  }))
  console.log('practice dots:', wrongDot)
  await page.screenshot({ path: 'docs/shots/28-practice-dots.png' })
  if (wrongDot.wrong !== 1 || !wrongDot.legend || !wrongDot.revealed) {
    fail(`练习模式答题卡没标出答错：${JSON.stringify(wrongDot)}`)
  }
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.segmented.small button')]
      .find((b) => b.textContent.trim() === '考试模式')
      ?.click()
  })
  await sleep(150)

  // ---------- 3. 字号 ----------
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.fs-btn')].find((b) => b.textContent === 'A+')?.click()
  })
  await sleep(200)
  const fsAfter = await page.evaluate(() => ({
    attr: document.documentElement.dataset.fs,
    stem: getComputedStyle(document.querySelector('.stem')).fontSize,
    label: document.querySelector('.fs-label')?.textContent,
  }))
  console.log('font scale:', fsAfter)
  if (fsAfter.attr !== '1' || parseFloat(fsAfter.stem) < 17) fail(`字号没生效：${JSON.stringify(fsAfter)}`)

  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(800)
  const fsPersisted = await page.evaluate(() => document.documentElement.dataset.fs)
  if (fsPersisted !== '1') fail('刷新后字号没有保持')
  // 恢复标准字号，免得影响后面的截图
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.fs-btn')].find((b) => b.textContent === 'A-')?.click()
  })

  // ---------- 1. 未作答确认 ----------
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.quiz-top button')].find((b) => b.textContent.trim() === '交卷')?.click()
  })
  await page.waitForSelector('.modal', { timeout: 5000 })
  const modalText = await page.$eval('.modal', (el) => el.innerText.replace(/\s+/g, ' '))
  console.log('modal:', modalText)
  if (!/还有 \d+ 题没作答/.test(modalText)) fail('弹窗没提示未答数量')
  await page.screenshot({ path: 'docs/shots/26-unanswered-modal.png' })

  const beforeJump = await page.$eval('.dot.current', (el) => el.textContent)
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.modal button')]
      .find((b) => b.textContent.includes('跳到第一道未答'))
      ?.click()
  })
  await sleep(300)
  const afterJump = await page.$eval('.dot.current', (el) => el.textContent)
  console.log('jump:', beforeJump, '→', afterJump)
  if (beforeJump === afterJump) fail('没有跳到第一道未答')

  // 继续作答按钮能关掉弹窗
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.quiz-top button')].find((b) => b.textContent.trim() === '交卷')?.click()
  })
  await page.waitForSelector('.modal', { timeout: 5000 })
  await page.screenshot({ path: 'docs/shots/25-dots-state.png' })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('继续作答'))?.click()
  })
  await sleep(200)
  const modalClosed = await page.evaluate(() => document.querySelector('.modal') === null)
  if (!modalClosed) fail('继续作答没关掉弹窗')

  // 直接交卷 → 结果页，且结果页有自己的 hash
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.quiz-top button')].find((b) => b.textContent.trim() === '交卷')?.click()
  })
  await page.waitForSelector('.modal', { timeout: 5000 })
  await page.evaluate(() => {
    ;[...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('直接交卷'))?.click()
  })
  await page.waitForFunction(() => location.hash.startsWith('#/result/'), { timeout: 8000 })
  await sleep(500)
  const resultHash = await page.evaluate(() => location.hash)

  // 刷新结果页仍然能回到这一次记录
  await page.reload({ waitUntil: 'networkidle2' })
  await sleep(900)
  const resultAfterReload = await page.evaluate(
    () => location.hash.startsWith('#/result/') && document.body.innerText.includes('练习结果'),
  )
  if (!resultAfterReload) fail('刷新后结果页丢了')

  // 浏览器后退回到刷题前的来源页
  await page.goBack({ waitUntil: 'networkidle2' })
  await sleep(700)
  const afterBack = await page.evaluate(() => location.hash)
  console.log('after goBack:', afterBack)
  // 交卷用的是 replaceState，后退不该又回到那套已交的题
  if (afterBack.startsWith('#/quiz/')) fail('后退又回到了刷题页')

  await page.screenshot({ path: 'docs/shots/27-route-result.png' })

  console.log(
    JSON.stringify(
      { ok: true, bankHash, quizHash, resultHash, dotStates, fsAfter, errors },
      null,
      2,
    ),
  )
  if (errors.length) throw new Error(`页面报错：${errors.join('; ')}`)
} catch (e) {
  console.error('FAILED:', e.message, JSON.stringify(errors))
  await page.screenshot({ path: 'docs/shots/99-ux-failure.png' }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}

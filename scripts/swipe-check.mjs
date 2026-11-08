import puppeteer from 'puppeteer-core'

/**
 * 手机端左右滑动翻题的回归测试。
 *
 * 覆盖：
 *  - 左滑下一题 / 右滑上一题 / 短滑不换题 / 首尾回弹
 *  - 点选项不会因为滑动被吞掉，滑动也不会误选
 *  - 竖向滚动不被劫持
 *  - 练习模式点没点「对答案」都能滑，且翻回来答案状态还在
 *  - 题号条横向拖动不触发翻题
 *  - 首次提示只出现一次
 *  - 桌面鼠标拖拽不触发翻题
 */

const EDGE = 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe'
const BASE = process.env.BASE_URL || 'http://localhost:5173'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function buildMarkdown(n = 40) {
  const lines = ['# 滑动测试题库', '']
  for (let i = 1; i <= n; i++) {
    if (i % 5 === 0) {
      lines.push(`## ${i}. 下列哪些属于传输层协议？（第 ${i} 题）`)
      lines.push('- A. TCP', '- B. UDP', '- C. HTTP', '- D. ICMP')
      lines.push('> 答案：A,B', `> 解析：第 ${i} 题解析。`, '> 类型：多选')
    } else if (i % 5 === 1) {
      lines.push(`## ${i}. TCP 是面向连接的协议。（第 ${i} 题）`)
      lines.push('- A. 正确', '- B. 错误')
      lines.push('> 答案：A', `> 解析：第 ${i} 题解析。`, '> 类型：判断')
    } else {
      lines.push(`## ${i}. 路由器工作在 OSI 的哪一层？（第 ${i} 题）`)
      lines.push('- A. 物理层', '- B. 网络层', '- C. 应用层', '- D. 传输层')
      lines.push('> 答案：B', `> 解析：第 ${i} 题解析。`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    console.log(`  ok   ${name}`)
  } else {
    failures.push(name + (detail ? ` (${detail})` : ''))
    console.log(`  FAIL ${name} ${detail}`)
  }
}

async function clickButton(page, text) {
  const clicked = await page.evaluate((label) => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').trim().includes(label),
    )
    btn?.click()
    return Boolean(btn)
  }, text)
  if (!clicked) throw new Error(`找不到按钮「${text}」`)
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
})

const errors = []
const page = await browser.newPage()
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`))

const cdp = await page.createCDPSession()

async function touchMoveTo(points) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points })
}

/** 一次真实的手指滑动（坐标是 CSS 像素），起止点可以不同方向 */
// settle 留 650ms：viewport 没关掉双击缩放，浏览器在滑动手势结束后
// 约 500ms 内会把下一次点按当成「双击」而吞掉 click，等过了再点更接近真人操作。
async function swipeTo(fromX, fromY, toX, toY, steps = 12, settle = 650) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: fromX, y: fromY, id: 1 }],
  })
  for (let i = 1; i <= steps; i++) {
    const x = fromX + ((toX - fromX) * i) / steps
    const y = fromY + ((toY - fromY) * i) / steps
    await sleep(10)
    await touchMoveTo([{ x, y, id: 1 }])
  }
  await sleep(20)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(settle)
}

async function tap(x, y) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
  })
  await sleep(40)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(250)
}

const currentDot = () => page.$eval('.dot.current', (el) => (el.textContent ?? '').trim())
const dotCount = () => page.$$eval('.dot', (els) => els.length)

/** 每次滑动前重新量：提示条收起、换题后布局都会变 */
async function stageGeom() {
  return page.$eval('.swipe-stage', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
}

/**
 * 在题干/选项区域横向滑动。
 * dir=-1 左滑（下一题），dir=1 右滑（上一题）；ratio 控制幅度，1 为正常，0.1 模拟短滑。
 */
async function swipeStage(dir, ratio = 1, settle = 650) {
  const b = await stageGeom()
  const y = b.y + b.h * 0.28
  const mid = b.x + b.w / 2
  const span = b.w * 0.35 * ratio
  const from = dir < 0 ? mid + span : mid - span
  const to = dir < 0 ? mid - span : mid + span
  await swipeTo(from, y, to, y, 12, settle)
}

/** 竖向滑动：确认页面滚动没被劫持 */
async function swipeVertical(dy) {
  const b = await stageGeom()
  const x = b.x + b.w / 2
  const y = b.y + b.h * 0.6
  await swipeTo(x, y, x, y - dy)
}

/** 等换题动画彻底结束（transform 回到 none/单位矩阵） */
async function waitStageIdle(timeout = 3000) {
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.swipe-stage')
      if (!el) return false
      const t = getComputedStyle(el).transform
      return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)'
    },
    { timeout },
  )
}

/** 点题号条找到第一种指定题型的题，返回下标（找不到 -1） */
async function findQuestionByType(kind) {
  const total = await dotCount()
  for (let i = 0; i < total; i++) {
    await page.evaluate((n) => document.querySelectorAll('.dot')[n].click(), i)
    await sleep(90)
    const cls = await page.$eval('.badge', (el) => el.className)
    if (cls.includes(`type-${kind}`)) return i
  }
  return -1
}

try {
  await page.goto(BASE, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.empty-state, .grid', { timeout: 10000 })

  await clickButton(page, '导入文件')
  await page.waitForSelector('textarea.editor', { timeout: 5000 })
  await page.evaluate((md) => {
    const ta = document.querySelector('textarea.editor')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(ta, md)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  }, buildMarkdown(40))
  await page.waitForFunction(() => document.body.innerText.includes('题可导入'), { timeout: 5000 })
  await clickButton(page, '导入 40 题')
  await page.waitForFunction(() => document.body.innerText.includes('每次练习随机抽'), { timeout: 8000 })
  await clickButton(page, '开始刷题')
  await page.waitForSelector('.option', { timeout: 8000 })
  await page.waitForSelector('.swipe-stage', { timeout: 5000 })
  await sleep(300)

  // 1. 首次提示
  const hintShown = (await page.$('.swipe-hint')) !== null
  check('首次进入显示滑动提示', hintShown)
  const hintStored = await page.evaluate(() => localStorage.getItem('practice.swipeHintShown'))
  check('提示只记一次（已写入标记）', hintStored === '1')

  // 2. 左滑下一题
  check('初始在第 1 题', (await currentDot()) === '1')
  await swipeStage(-1)
  check('左滑进入第 2 题', (await currentDot()) === '2', `current=${await currentDot()}`)
  check('滑动后提示条已收起', (await page.$('.swipe-hint')) === null)

  // 3. 右滑回上一题
  await swipeStage(1)
  check('右滑回到第 1 题', (await currentDot()) === '1', `current=${await currentDot()}`)

  // 4. 短滑不翻页
  await swipeStage(-1, 0.1)
  check('短距离滑动不翻页', (await currentDot()) === '1', `current=${await currentDot()}`)

  // 5. 第一题继续往右滑：回弹
  await swipeStage(1)
  check('第一题右滑回弹', (await currentDot()) === '1', `current=${await currentDot()}`)

  // 6. 点选项照常生效，且不会翻页
  // 先切到单选/判断题：多选题再点一下会取消选中，断言会因题型而飘
  let tapIdx = await findQuestionByType('single')
  if (tapIdx < 0) tapIdx = await findQuestionByType('judge')
  check('找到单选/判断题（测试前提）', tapIdx >= 0)
  const dotBeforeTap = await currentDot()
  const optBox = await page.$eval('.option', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await tap(optBox.x, optBox.y)
  const selected = await page.$$eval('.option.selected', (els) => els.length)
  check('点选项能选中', selected === 1, `selected=${selected}`)
  check('点选项不会误翻页', (await currentDot()) === dotBeforeTap, `current=${await currentDot()}`)

  // 6b. 滑动动画结束后点选项：防误触的点击拦截不能留下尾巴
  await swipeStage(-1)
  await waitStageIdle()
  const quickDot = await currentDot()
  check('滑动后已翻到新题（测试前提）', quickDot !== dotBeforeTap, `current=${quickDot}`)
  const quickOpt = await page.$eval('.option', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await tap(quickOpt.x, quickOpt.y)
  const quickSelected = await page.$$eval('.option.selected', (els) => els.length)
  check('滑完点选项能选中', quickSelected === 1, `selected=${quickSelected}`)

  // 7. 竖向滑动不劫持翻页
  const dotBeforeVertical = await currentDot()
  await swipeVertical(120)
  check('竖向滑动不翻页', (await currentDot()) === dotBeforeVertical, `current=${await currentDot()}`)

  // 8. 练习模式：不管点没点「对答案」都能滑，翻回来状态还在
  await clickButton(page, '练习模式')
  await sleep(300)

  // 8a. 多选题：没点「对答案」也能滑
  const multipleIdx = await findQuestionByType('multiple')
  check('题库里有多选题（测试前提）', multipleIdx >= 0)
  if (multipleIdx >= 0) {
    const total = await dotCount()
    const before = await currentDot()
    const forward = Number(before) < total
    await swipeStage(forward ? -1 : 1)
    const middle = await currentDot()
    await swipeStage(forward ? 1 : -1)
    check(
      '多选题未揭晓也能滑动',
      middle !== before && (await currentDot()) === before,
      `${before}->${middle}->${await currentDot()}`,
    )
  }

  // 8b. 单选/判断：点完立刻揭晓，滑走再滑回，解析和选中都还在
  let simpleIdx = await findQuestionByType('single')
  if (simpleIdx < 0) simpleIdx = await findQuestionByType('judge')
  check('题库里有单选/判断题（测试前提）', simpleIdx >= 0)
  const qStem = await page.$eval('.stem', (el) => el.textContent)
  const firstOpt = await page.$eval('.option', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await tap(firstOpt.x, firstOpt.y)
  await sleep(250)
  const revealBefore = (await page.$('.reveal')) !== null
  const selectedBefore = await page.$$eval('.option.selected', (els) => els.length)
  check('练习模式单选点完立刻揭晓', revealBefore && selectedBefore === 1)
  const simpleDot = await currentDot()
  await swipeStage(-1)
  check('揭晓后左滑正常翻页', (await currentDot()) !== simpleDot, `current=${await currentDot()}`)
  await swipeStage(1)
  const revealAfter = (await page.$('.reveal')) !== null
  const selectedAfter = await page.$$eval('.option.selected', (els) => els.length)
  check('翻回来解析状态还在', revealAfter === revealBefore && selectedAfter === selectedBefore)
  check('翻回来题干没变', (await page.$eval('.stem', (el) => el.textContent)) === qStem)

  // 9. 最后一题：不能再往左翻
  await page.evaluate(() => {
    document.querySelector('.dots').scrollLeft = 1e9
  })
  await sleep(200)
  const lastDotBox = await page.$$eval('.dot', (els) => {
    const r = els[els.length - 1].getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  await tap(lastDotBox.x, lastDotBox.y)
  await sleep(300)
  const totalDots = await dotCount()
  const lastIdx = await currentDot()
  check('已跳到最后一题', lastIdx === String(totalDots), `current=${lastIdx}/${totalDots}`)
  await swipeStage(-1)
  check('最后一题左滑不越界', (await currentDot()) === lastIdx, `current=${await currentDot()}`)

  // 10. 题号条横向拖动不翻题
  const dotsBox = await page.$eval('.dots', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x + r.width - 30, y: r.y + r.height / 2, scrollable: el.scrollWidth > el.clientWidth + 4 }
  })
  check('题号条可横向滚动（测试前提）', dotsBox.scrollable)
  const idxBeforeDots = await currentDot()
  await swipeTo(dotsBox.x, dotsBox.y, dotsBox.x - 140, dotsBox.y)
  check('题号条上拖动不翻题', (await currentDot()) === idxBeforeDots, `current=${await currentDot()}`)

  // 11. 刷新后提示不再出现（草稿恢复）
  await page.evaluate(() => document.querySelectorAll('.dot')[0].click())
  await page.waitForFunction(() => document.querySelector('.dot.current')?.textContent?.trim() === '1', { timeout: 5000 })
  await sleep(500)
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.option', { timeout: 8000 })
  await sleep(300)
  check('刷新后不再弹提示', (await page.$('.swipe-hint')) === null)
  check('刷新后草稿恢复在第 1 题', (await currentDot()) === '1', `current=${await currentDot()}`)

  // 12. 桌面鼠标拖拽：不翻页、不影响点选
  const desktop = await browser.newPage()
  await desktop.setViewport({ width: 1280, height: 900 })
  const dcdp = await desktop.createCDPSession()
  await desktop.goto(`${BASE}/#/banks`, { waitUntil: 'networkidle0' })
  await desktop.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始刷题'))?.click()
  })
  await desktop.waitForSelector('.option', { timeout: 8000 })
  await sleep(300)
  const dbox = await desktop.$eval('.swipe-stage', (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, cy: r.y + r.height / 2 }
  })
  await dcdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: dbox.x + 500, y: dbox.cy, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 10; i++) {
    await dcdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dbox.x + 500 - i * 30,
      y: dbox.cy,
      button: 'left',
      buttons: 1,
    })
    await sleep(12)
  }
  await dcdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dbox.x + 200, y: dbox.cy, button: 'left', clickCount: 1 })
  await sleep(400)
  const desktopDot = await desktop.$eval('.dot.current', (el) => el.textContent.trim())
  check('桌面鼠标拖拽不翻题', desktopDot === '1', `current=${desktopDot}`)
  await desktop.close()

  const dotTotal = await dotCount()
  console.log('\n题目数:', dotTotal, '| 页面错误:', errors.length ? errors : '无')
  console.log(JSON.stringify({ ok: failures.length === 0, failures, errors }, null, 2))
} catch (e) {
  console.error('SWIPE CHECK FAILED:', e.message)
  await page.screenshot({ path: 'docs/shots/swipe-failure.png', fullPage: true })
  console.log(JSON.stringify({ ok: false, failures, errors, error: e.message }, null, 2))
  process.exitCode = 1
} finally {
  await browser.close()
}

if (failures.length || errors.length) process.exitCode = 1
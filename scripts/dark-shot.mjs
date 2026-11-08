import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  defaultViewport: { width: 1360, height: 900 },
})
const page = await browser.newPage()
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }])
await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' })
await new Promise((r) => setTimeout(r, 400))
await page.screenshot({ path: 'docs/shots/08-dark-empty.png' })

const buttons = await page.$$('button')
for (const h of buttons) {
  const t = await page.evaluate((el) => el.textContent ?? '', h)
  if (t.includes('导入文件') || t.includes('导入第一份')) {
    await h.click()
    break
  }
}
await new Promise((r) => setTimeout(r, 500))
await page.screenshot({ path: 'docs/shots/09-dark-import.png' })
await browser.close()
console.log('dark shots ok')

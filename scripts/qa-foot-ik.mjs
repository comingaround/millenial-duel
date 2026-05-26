import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } })
const page = await ctx.newPage()
page.on('pageerror', (err) => console.error('[page error]', err.message))

await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean((window).__editor && (window).__bjs), { timeout: 15000 })

await page.evaluate(() => {
  ;(window).__bjs.setCameraMode('editor')
  ;(window).__editor.selectBone('Foot.L')
  ;(window).__editor.setBonePickerActive?.(false)
})
await page.waitForTimeout(400)

const before = await page.evaluate(() => (window).__editor.debugBoneWorld?.('Foot.L'))

// Lift Foot.L 20cm up
await page.evaluate(() => {
  for (let i = 0; i < 20; i++) (window).__editor.translateSelectedBone('y', 0.01)
})
await page.waitForTimeout(300)

const after = await page.evaluate(() => (window).__editor.debugBoneWorld?.('Foot.L'))
await page.screenshot({ path: join(OUT_DIR, 'foot-ik-lift.png') })

console.log('Foot.L before:', JSON.stringify(before))
console.log('Foot.L after :', JSON.stringify(after))
const d = [
  +(after.worldPos[0] - before.worldPos[0]).toFixed(4),
  +(after.worldPos[1] - before.worldPos[1]).toFixed(4),
  +(after.worldPos[2] - before.worldPos[2]).toFixed(4),
]
console.log('drift (want 0,+0.20,0):', d)

await browser.close()

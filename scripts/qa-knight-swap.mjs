import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[hero]') || m.type() === 'error') console.log('[console]', t)
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3500)
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(51, 1.0, 0)
  cam.radius = 5
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'knight-swap-editor.png') })
// Hero in duel scene.
await page.evaluate(() => {
  window.__bjs.setCameraMode('free')
  const cam = window.__bjs.scene.activeCamera
  cam.target?.copyFromFloats?.(0, 1.2, -8)
  cam.alpha = -Math.PI / 4
  cam.beta = Math.PI / 2.2
  cam.radius = 2.5
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'knight-swap-hero.png') })
await browser.close()

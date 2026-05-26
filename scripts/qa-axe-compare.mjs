import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  if (m.text().includes('[editor]') || m.type() === 'error') console.log(`[console]`, m.text())
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(2500)
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(54.4, 0.9, 0)
  cam.radius = 2.5
  cam.alpha = Math.PI / 2
  cam.beta = Math.PI / 2.5
})
await page.waitForTimeout(600)
const info = await page.evaluate(() => {
  const meshes = window.__bjs.scene.meshes.filter(m => m.name.startsWith('__preview_'))
  return meshes.map(m => {
    m.computeWorldMatrix(true)
    m.refreshBoundingInfo()
    const bb = m.getBoundingInfo().boundingBox
    return {
      name: m.name,
      maxDim: +Math.max(bb.maximumWorld.x - bb.minimumWorld.x, bb.maximumWorld.y - bb.minimumWorld.y, bb.maximumWorld.z - bb.minimumWorld.z).toFixed(3),
      hasAlbedoTexture: !!m.material?.albedoTexture,
      matClass: m.material?.constructor?.name,
    }
  })
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: join(OUT_DIR, 'axe-compare.png') })
await browser.close()

import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || m.type() === 'error') console.log('[console]', t)
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(4000)

await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(54.0, 1.0, 0)
  cam.radius = 4
  cam.alpha = Math.PI / 2
  cam.beta = Math.PI / 2.4
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'meshy-axe-vs-custom.png') })

// Close-up of just the axe.
await page.evaluate(() => {
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(54.5, 1.0, 0)
  cam.radius = 1.5
})
await page.waitForTimeout(400)
await page.screenshot({ path: join(OUT, 'meshy-axe-close.png') })

const info = await page.evaluate(() => {
  const meshes = window.__bjs.scene.meshes.filter(m => m.name.startsWith('__preview_double_edge_axe'))
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
  let totalVerts = 0
  let materials = new Set()
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    m.refreshBoundingInfo()
    const bb = m.getBoundingInfo().boundingBox
    if (bb.minimumWorld.y < minY) minY = bb.minimumWorld.y
    if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y
    if (bb.minimumWorld.x < minX) minX = bb.minimumWorld.x
    if (bb.maximumWorld.x > maxX) maxX = bb.maximumWorld.x
    totalVerts += m.getTotalVertices()
    if (m.material) materials.add(m.material.constructor.name + (m.material.albedoTexture ? '+tex' : ''))
  }
  return {
    meshCount: meshes.length,
    totalVerts,
    materials: Array.from(materials),
    heightM: +(maxY - minY).toFixed(3),
    widthM: +(maxX - minX).toFixed(3),
  }
})
console.log('[QA]', JSON.stringify(info, null, 2))
await browser.close()

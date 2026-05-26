import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'qa-screenshots')
const URL = 'http://192.168.1.76:5173'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await ctx.newPage()
page.on('pageerror', (err) => console.error('[page error]', err.message))
page.on('console', (m) => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[creator]') || m.type() === 'error') {
    console.log(`[console ${m.type()}]`, t)
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
// Editor scene loads asynchronously after the editor API is up — let weapon
// library finish + a couple of render frames before measuring.
await page.waitForTimeout(2500)

// Switch to Editor camera + focus on Custom (idx 2) so the axe is in view.
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.setActiveModel?.(2)
  window.__editor.focusModel?.(2)
})
await page.waitForTimeout(600)

// Measure the axe's actual world bounding box.
const measurement = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const meshes = scene.meshes.filter((m) => m.name.startsWith('__preview_copper_axe'))
  if (meshes.length === 0) return { error: 'no preview meshes found' }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    m.refreshBoundingInfo()
    const bb = m.getBoundingInfo().boundingBox
    const min = bb.minimumWorld
    const max = bb.maximumWorld
    if (min.x < minX) minX = min.x
    if (min.y < minY) minY = min.y
    if (min.z < minZ) minZ = min.z
    if (max.x > maxX) maxX = max.x
    if (max.y > maxY) maxY = max.y
    if (max.z > maxZ) maxZ = max.z
  }
  return {
    meshCount: meshes.length,
    min: { x: +minX.toFixed(3), y: +minY.toFixed(3), z: +minZ.toFixed(3) },
    max: { x: +maxX.toFixed(3), y: +maxY.toFixed(3), z: +maxZ.toFixed(3) },
    dim: {
      x: +(maxX - minX).toFixed(3),
      y: +(maxY - minY).toFixed(3),
      z: +(maxZ - minZ).toFixed(3),
    },
    maxDim: +Math.max(maxX - minX, maxY - minY, maxZ - minZ).toFixed(3),
  }
})

console.log('\n[QA] copper_axe measurement:', JSON.stringify(measurement, null, 2))

// Reference: Custom model is a knight scaled 1.2× ≈ 2.16m tall. An axe
// in a knight's hand should be ~50-70cm head-to-handle.
if (measurement.maxDim) {
  const knightHeight = 2.16
  console.log(`[QA] axe max-dim ${measurement.maxDim}m vs knight ${knightHeight}m = ${(measurement.maxDim / knightHeight * 100).toFixed(0)}% of knight height`)
  if (measurement.maxDim > 1.0) console.log('[QA] AXE IS TOO LARGE — should be ~0.5-0.7m for a one-handed axe')
  else if (measurement.maxDim < 0.3) console.log('[QA] AXE IS TOO SMALL — should be ~0.5-0.7m')
  else console.log('[QA] axe size looks reasonable')
}

await page.screenshot({ path: join(OUT_DIR, 'weapon-size-1-default.png'), fullPage: false })

// Pull camera in close to the axe for a detail shot.
await page.evaluate(() => {
  const cam = window.__bjs.scene.activeCamera
  if (cam && 'target' in cam) {
    cam.target.copyFromFloats(54.0, 1.0, 0)
    cam.radius = 1.5
  }
})
await page.waitForTimeout(400)
await page.screenshot({ path: join(OUT_DIR, 'weapon-size-2-close.png'), fullPage: false })

await browser.close()
console.log('\nScreenshots saved:')
console.log(' ', join(OUT_DIR, 'weapon-size-1-default.png'))
console.log(' ', join(OUT_DIR, 'weapon-size-2-close.png'))

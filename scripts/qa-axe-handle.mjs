import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[weapon]') || m.type() === 'error') console.log('[console]', t)
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3500)

await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.focusModel(0)  // Model 1 has the axe
  const cam = window.__bjs.scene.activeCamera
  cam.radius = 3
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'axe-handle-model1.png') })

await page.evaluate(() => {
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(51, 1.0, 0)
  cam.radius = 5
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'axe-handle-vs-sword.png') })

// Measure axe + sword.
const info = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const collect = (root) => {
    let minY = Infinity, maxY = -Infinity
    const stack = [root]
    while (stack.length) {
      const n = stack.shift()
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
      if (!n.getTotalVertices || n.getTotalVertices() === 0) continue
      if (!n.isEnabled()) continue
      n.computeWorldMatrix(true)
      n.refreshBoundingInfo()
      const bb = n.getBoundingInfo().boundingBox
      if (bb.minimumWorld.y < minY) minY = bb.minimumWorld.y
      if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y
    }
    return maxY - minY
  }
  // Model 1's axe.
  const axeRoot = scene.meshes.find(m => m.name.startsWith('weapon_axe_textured_root'))
  // Model 2's stock sword — should be the sword/blade meshes still parented to Hand Hold.R on Model 2.
  // Just find any visible mesh whose name contains Sword/Blade on Model 2's hierarchy.
  const m2 = scene.transformNodes.find(n => n.name === 'Model 2')
  let m2SwordHeight = null
  if (m2) {
    // Locate Hand Hold.R on Model 2.
    const stack = [m2]
    while (stack.length) {
      const n = stack.shift()
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
      if (n.name === 'Hand Hold.R') {
        m2SwordHeight = collect(n)
        break
      }
    }
  }
  return {
    axeHeight: axeRoot ? collect(axeRoot) : null,
    m2SwordHeight,
  }
})
console.log('[QA] measurements:', JSON.stringify(info, null, 2))

await browser.close()

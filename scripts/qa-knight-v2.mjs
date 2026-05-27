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
await page.waitForTimeout(3500)

await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(54.5, 1.0, 0)
  cam.radius = 4.5
  cam.alpha = Math.PI / 2
  cam.beta = Math.PI / 2.3
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'knight-v2-pair.png') })

// Wide view including Custom + Model 1+2 for context.
await page.evaluate(() => {
  const cam = window.__bjs.scene.activeCamera
  cam.target.copyFromFloats(53, 1.0, 0)
  cam.radius = 10
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT, 'knight-v2-wide.png') })

const info = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const find = (n) => scene.transformNodes.find(t => t.name === n) ?? scene.meshes.find(m => m.name === n)
  const collectBB = (root) => {
    let minY = Infinity, maxY = -Infinity
    const stack = [root]
    while (stack.length) {
      const n = stack.shift()
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
      if (!n.getTotalVertices || n.getTotalVertices() === 0) continue
      n.computeWorldMatrix(true)
      n.refreshBoundingInfo()
      const bb = n.getBoundingInfo().boundingBox
      if (bb.minimumWorld.y < minY) minY = bb.minimumWorld.y
      if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y
    }
    return { minY, maxY, height: maxY - minY }
  }
  return {
    v2Native: find('KnightV2-native') && collectBB(find('KnightV2-native')),
    v2Fbx: find('KnightV2-fbx2gltf') && collectBB(find('KnightV2-fbx2gltf')),
    model1: find('Model 1') && collectBB(find('Model 1')),
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

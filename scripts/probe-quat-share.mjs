import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3000)
// Find each model's Hips bone via the engine's debug helper.
const result = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const findHips = (rootName) => {
    const root = scene.transformNodes.find(n => n.name === rootName) ?? scene.meshes.find(m => m.name === rootName)
    if (!root) return null
    const stack = [root]
    while (stack.length) {
      const n = stack.shift()
      if (n.name === 'Hips') return n
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
    }
    return null
  }
  const h1 = findHips('Model 1')
  const h2 = findHips('Model 2')
  const hC = findHips('Custom')
  // Take MARKER on each quaternion so we can tell if they're the same object.
  if (h1.rotationQuaternion) h1.rotationQuaternion.__probe = 'm1'
  if (h2.rotationQuaternion) h2.rotationQuaternion.__probe = 'm2'
  if (hC.rotationQuaternion) hC.rotationQuaternion.__probe = 'custom'
  return {
    h1NodeUID: h1.uniqueId,
    h2NodeUID: h2.uniqueId,
    hCNodeUID: hC.uniqueId,
    h1QuatProbe: h1.rotationQuaternion?.__probe,
    h2QuatProbe: h2.rotationQuaternion?.__probe,
    hCQuatProbe: hC.rotationQuaternion?.__probe,
    quatRefSameH1H2: h1.rotationQuaternion === h2.rotationQuaternion,
    quatRefSameH1HC: h1.rotationQuaternion === hC.rotationQuaternion,
    quatRefSameH2HC: h2.rotationQuaternion === hC.rotationQuaternion,
  }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()

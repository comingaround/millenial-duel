import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const ed = window.__editor
  const out = {}
  for (let i = 0; i < 3; i++) {
    ed.setActiveModel(i)
    // not enough — access raw models via scene
  }
  // Use the internal models. They live on ed; might not be exposed. Try scene.
  const scene = window.__bjs.scene
  // Find each model's root by name.
  const root1 = scene.transformNodes.find(n => n.name === 'Model 1') ?? scene.meshes.find(m => m.name === 'Model 1')
  const root2 = scene.transformNodes.find(n => n.name === 'Model 2') ?? scene.meshes.find(m => m.name === 'Model 2')
  const rootC = scene.transformNodes.find(n => n.name === 'Custom') ?? scene.meshes.find(m => m.name === 'Custom')
  // Walk each root looking for a node named "Hips".
  const findHips = (root) => {
    const stack = [root]
    while (stack.length) {
      const n = stack.shift()
      if (!n) continue
      if (n.name === 'Hips') return n
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
    }
    return null
  }
  const h1 = findHips(root1)
  const h2 = findHips(root2)
  const hC = findHips(rootC)
  return {
    root1Name: root1?.name, root1UID: root1?.uniqueId,
    root2Name: root2?.name, root2UID: root2?.uniqueId,
    rootCName: rootC?.name, rootCUID: rootC?.uniqueId,
    hipsModel1UID: h1?.uniqueId, hipsModel2UID: h2?.uniqueId, hipsCustomUID: hC?.uniqueId,
    m2_eq_Custom: h2 === hC,
    m1_eq_m2: h1 === h2,
    countHipsInScene: scene.transformNodes.filter(n => n.name === 'Hips').length + scene.meshes.filter(m => m.name === 'Hips').length,
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

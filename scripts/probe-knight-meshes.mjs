import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3000)
const info = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const m1 = scene.transformNodes.find(n => n.name === 'Model 1') ?? scene.meshes.find(n => n.name === 'Model 1')
  if (!m1) return { error: 'no Model 1' }
  // Walk descendants for skinned meshes.
  const seenStems = new Set()
  const meshes = []
  const stack = [m1]
  while (stack.length) {
    const n = stack.shift()
    for (const c of (n.getChildren?.() ?? [])) stack.push(c)
    if (!n.skeleton) continue
    if (!n.getTotalVertices || n.getTotalVertices() === 0) continue
    const stem = n.name.split('_primitive')[0]
    if (seenStems.has(stem)) continue
    seenStems.add(stem)
    meshes.push({
      stem,
      verts: n.getTotalVertices(),
      matName: n.material?.name ?? null,
    })
  }
  return { meshes }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

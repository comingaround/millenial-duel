import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[creator]') || m.type() === 'error') console.log('[console]', t)
})

await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(2500)

// Switch to Custom + add the axe clone.
const cloneInfo = await page.evaluate(() => {
  const ed = window.__editor
  ed.setActiveModel(2)
  const targets = ed.getCreatorTargets()
  const axe = targets.weapons.find(w => w.stem === 'axe_textured')
  if (!axe) return { error: 'no axe in library' }
  const id = ed.addCreatorWeaponClone(axe.stem, axe.members)
  return { id, axe }
})
console.log('[QA] addCreatorWeaponClone returned:', JSON.stringify(cloneInfo))
await page.waitForTimeout(600)

// Measure the cloned mesh (group root + children) world bounds.
const measurement = await page.evaluate((id) => {
  const scene = window.__bjs.scene
  const grp = scene.meshes.find(m => m.name === `creator_group_${id}`)
  if (!grp) return { error: 'no group root in scene' }
  // Walk all descendants (the children of the group root carry the geometry).
  const collect = (root) => {
    const out = [root]
    for (const c of root.getChildren()) out.push(...collect(c))
    return out
  }
  const all = collect(grp).filter(m => m.getTotalVertices && m.getTotalVertices() > 0)
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const m of all) {
    m.computeWorldMatrix(true)
    m.refreshBoundingInfo()
    const bb = m.getBoundingInfo().boundingBox
    if (bb.minimumWorld.x < minX) minX = bb.minimumWorld.x
    if (bb.minimumWorld.y < minY) minY = bb.minimumWorld.y
    if (bb.minimumWorld.z < minZ) minZ = bb.minimumWorld.z
    if (bb.maximumWorld.x > maxX) maxX = bb.maximumWorld.x
    if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y
    if (bb.maximumWorld.z > maxZ) maxZ = bb.maximumWorld.z
  }
  const child = all.find(m => m.name.startsWith('creator_group_') && m.name !== grp.name)
  return {
    descendantCount: all.length,
    min: { x: +minX.toFixed(3), y: +minY.toFixed(3), z: +minZ.toFixed(3) },
    max: { x: +maxX.toFixed(3), y: +maxY.toFixed(3), z: +maxZ.toFixed(3) },
    dim: { x: +(maxX - minX).toFixed(3), y: +(maxY - minY).toFixed(3), z: +(maxZ - minZ).toFixed(3) },
    maxDim: +Math.max(maxX - minX, maxY - minY, maxZ - minZ).toFixed(3),
    childMatClass: child?.material?.constructor?.name,
    childHasAlbedoTexture: !!child?.material?.albedoTexture,
  }
}, cloneInfo.id)
console.log('[QA] clone measurement:', JSON.stringify(measurement, null, 2))

// Frame camera on Custom (idx 2) so we can see the axe on the model's hand.
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.focusModel(2)
  const cam = window.__bjs.scene.activeCamera
  cam.radius = 3
})
await page.waitForTimeout(500)
await page.screenshot({ path: join(OUT_DIR, 'axe-clone-on-custom.png') })

await browser.close()
console.log('Screenshot:', join(OUT_DIR, 'axe-clone-on-custom.png'))

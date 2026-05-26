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
  if (m.type() === 'error') console.error('[console]', m.text())
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 20000 })

// Switch to editor camera + activate Custom model (idx 2)
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.setActiveModel?.(2)
})
await page.waitForTimeout(500)

const activeIdx = await page.evaluate(() => window.__editor.getActiveModelIndex?.())
console.log('active model idx:', activeIdx, '(want 2)')

// Add 4 parts to a spread of bones
const added = await page.evaluate(() => {
  const ed = window.__editor
  const ids = []
  ids.push(ed.addCreatorPart('sphere',   'Head'))
  ids.push(ed.addCreatorPart('box',      'Chest'))
  ids.push(ed.addCreatorPart('cylinder', 'Upper Arm.L'))
  ids.push(ed.addCreatorPart('capsule',  'Upper Leg.R'))
  return ids
})
console.log('added part ids:', added)

await page.waitForTimeout(400)
await page.screenshot({ path: join(OUT_DIR, 'creator-1-after-add.png') })

// Edit one part — recolor the head sphere red, shrink it
await page.evaluate((id) => {
  window.__editor.updateCreatorPart(id, {
    color: '#cc2222',
    scale: [0.10, 0.10, 0.10],
  })
}, added[0])
await page.waitForTimeout(200)
await page.screenshot({ path: join(OUT_DIR, 'creator-2-after-edit.png') })

// Read back state pre-reload
const partsBefore = await page.evaluate(() => window.__editor.getCreatorParts())
console.log('parts before reload:', partsBefore.length, JSON.stringify(partsBefore.map((p) => ({ b: p.boneName, s: p.shape, c: p.color }))))

// Force save flush (debounced 500ms); wait a bit more than that
await page.waitForTimeout(800)

// Reload page — persistence should rehydrate
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 20000 })
// Hydrate retry loop in EditorPanel polls every 200ms — give it time
await page.waitForTimeout(2000)

await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.setActiveModel?.(2)
})
await page.waitForTimeout(500)

const partsAfter = await page.evaluate(() => window.__editor.getCreatorParts())
console.log('parts after reload :', partsAfter.length, JSON.stringify(partsAfter.map((p) => ({ b: p.boneName, s: p.shape, c: p.color }))))

await page.screenshot({ path: join(OUT_DIR, 'creator-3-after-reload.png') })

const sameCount = partsBefore.length === partsAfter.length
const sameBones = partsBefore.every((p, i) => partsAfter[i] && p.boneName === partsAfter[i].boneName && p.shape === partsAfter[i].shape)
console.log('persistence OK:', sameCount && sameBones)

// Cleanup: delete everything so library.json doesn't leak state into next run
await page.evaluate(() => {
  const ids = window.__editor.getCreatorParts().map((p) => p.id)
  for (const id of ids) window.__editor.deleteCreatorPart(id)
})
await page.waitForTimeout(800)

await browser.close()

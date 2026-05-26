import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[hero]') || t.includes('[weapon]') || t.includes('[creator]') || m.type() === 'error') console.log('[console]', t)
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3000)

// 1) Editor — frame Model 1 (idx 0) so we can verify axe replaced the sword.
await page.evaluate(() => {
  window.__bjs.setCameraMode('editor')
  window.__editor.focusModel(0)
  const cam = window.__bjs.scene.activeCamera
  cam.radius = 2.5
})
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'axe-primary-model1.png') })

// 2) Free-roam over the hero (at 0,0,-8) — check axe is in the right hand.
await page.evaluate(() => {
  window.__bjs.setCameraMode('free')
  const cam = window.__bjs.scene.activeCamera
  if ('target' in cam && cam.target?.copyFromFloats) {
    cam.target.copyFromFloats(0, 1.3, -8)
    cam.alpha = -Math.PI / 4
    cam.beta = Math.PI / 2.2
    cam.radius = 2.5
  }
})
await page.waitForTimeout(600)
await page.screenshot({ path: join(OUT, 'axe-primary-hero.png') })

// Probe both worlds for weapon presence.
const probe = await page.evaluate(() => {
  const meshes = window.__bjs.scene.meshes
  const weaponRoots = meshes.filter(m => m.name.startsWith('weapon_'))
  const weaponChildren = meshes.filter(m => m.name.startsWith('weapon_axe_textured_child'))
  return {
    weaponRootCount: weaponRoots.length,
    weaponRootNames: weaponRoots.map(m => m.name),
    childCount: weaponChildren.length,
    matClass: weaponChildren[0]?.material?.constructor?.name,
    hasAlbedoTexture: !!weaponChildren[0]?.material?.albedoTexture,
  }
})
console.log('[QA] weapon probe:', JSON.stringify(probe, null, 2))

await browser.close()
console.log('Screenshots:', join(OUT, 'axe-primary-model1.png'), join(OUT, 'axe-primary-hero.png'))

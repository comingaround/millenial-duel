import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3000)
// Find each model's Hips bone via the engine's debug helper.
const before = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const get = (rootName) => {
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
  return {
    m1Hips: get('Model 1') && {
      uid: get('Model 1').uniqueId,
      q: get('Model 1').rotationQuaternion ? [...get('Model 1').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) : null,
    },
    m2Hips: get('Model 2') && {
      uid: get('Model 2').uniqueId,
      q: get('Model 2').rotationQuaternion ? [...get('Model 2').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) : null,
    },
    customHips: get('Custom') && {
      uid: get('Custom').uniqueId,
      q: get('Custom').rotationQuaternion ? [...get('Custom').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) : null,
    },
  }
})
console.log('BEFORE anim:', JSON.stringify(before, null, 2))

// Synthesize a 2-keyframe rotation animation on Hips and play ONLY on Model 2.
await page.evaluate(() => {
  const ed = window.__editor
  const keyframes = [
    { time: 0, anchor: { rotations: { Hips: [0, 0, 0, 1] }, positions: {} } },
    { time: 0.6, anchor: { rotations: { Hips: [0.3, 0, 0, 0.95] }, positions: {} } },
  ]
  ed.playAnimationOnModel(1, keyframes)  // 1 = Model 2
})
await page.waitForTimeout(800)  // let anim play through

const after = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const get = (rootName) => {
    const root = scene.transformNodes.find(n => n.name === rootName) ?? scene.meshes.find(m => m.name === rootName)
    const stack = [root]
    while (stack.length) {
      const n = stack.shift()
      if (n.name === 'Hips') return n
      for (const c of (n.getChildren?.() ?? [])) stack.push(c)
    }
    return null
  }
  return {
    m1Hips: { q: [...get('Model 1').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) },
    m2Hips: { q: [...get('Model 2').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) },
    customHips: { q: [...get('Custom').rotationQuaternion.asArray()].map(x => +x.toFixed(3)) },
  }
})
console.log('AFTER  anim on Model 2 only:', JSON.stringify(after, null, 2))

await page.screenshot({ path: '/mnt/c/Users/aleks/Desktop/duel-game/scripts/qa-screenshots/anim-bleed.png' })
await browser.close()

import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
page.on('console', m => {
  const t = m.text()
  if (t.includes('[editor]') || t.includes('[retarget]') || m.type() === 'error') console.log('[console]', t)
})
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(4500)
const info = await page.evaluate(() => {
  const ed = window.__editor
  const legacy = ed.getLegacyRestPose?.()
  const current = ed.getInitialAnchor?.()
  return {
    legacyAvailable: !!legacy,
    legacyHipsRot: legacy?.rotations?.Hips,
    legacyHipsPos: legacy?.positions?.Hips,
    currentHipsRot: current?.rotations?.Hips,
    currentHipsPos: current?.positions?.Hips,
    legacyBoneCount: legacy ? Object.keys(legacy.rotations).length : 0,
    currentBoneCount: current ? Object.keys(current.rotations).length : 0,
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

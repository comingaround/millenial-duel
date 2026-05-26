// Diagnose hips translation + leg-plant IK.
//   1) Switch to editor mode, select Hips
//   2) Read foot world positions before
//   3) Translate Hips by 10cm in each axis
//   4) Read foot positions after, log delta + leg-bone rotations
//   5) Screenshot before + after

import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = 'http://192.168.1.76:5173'
const OUT_DIR = join(__dirname, 'qa-screenshots')

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } })
const page = await ctx.newPage()

page.on('pageerror', (err) => console.error('[page error]', err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    console.log(`[console ${msg.type()}]`, msg.text())
  }
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => Boolean((window).__editor && (window).__bjs),
  { timeout: 15000 },
)

// Setup: editor camera, select Hips, hide bone picker for clean shots
await page.evaluate(() => {
  ;(window).__bjs.setCameraMode('editor')
  ;(window).__editor.selectBone('Hips')
  ;(window).__editor.setBonePickerActive?.(false)
  ;(window).__ikDebug = true
})
await page.waitForTimeout(400)

// Capture all console.log output for the IK debug lines
page.on('console', (msg) => {
  if (msg.type() === 'log') console.log('[BROWSER]', msg.text())
})

const inspect = async () => {
  return await page.evaluate(() => {
    const ed = (window).__editor
    const r = (name) => ed.debugBoneWorld?.(name)
    return {
      hips:      r('Hips'),
      upperLegL: r('Upper Leg.L'),
      lowerLegL: r('Lower Leg.L'),
      footL:     r('Foot.L'),
      upperLegR: r('Upper Leg.R'),
      lowerLegR: r('Lower Leg.R'),
      footR:     r('Foot.R'),
    }
  })
}

const before = await inspect()
console.log('BEFORE:', JSON.stringify(before, null, 2))
await page.screenshot({ path: join(OUT_DIR, 'ik-before.png') })

// Apply Hips Y -10cm
await page.evaluate(() => {
  ;(window).__editor.translateSelectedBone('y', -0.10)
})
await page.waitForTimeout(300)

const after = await inspect()
console.log('\nAFTER Hips Y -10cm:', JSON.stringify(after, null, 2))
await page.screenshot({ path: join(OUT_DIR, 'ik-after-y.png') })

const drift = (b, a) => {
  if (!b?.worldPos || !a?.worldPos) return null
  return [
    +(a.worldPos[0] - b.worldPos[0]).toFixed(4),
    +(a.worldPos[1] - b.worldPos[1]).toFixed(4),
    +(a.worldPos[2] - b.worldPos[2]).toFixed(4),
  ]
}
console.log('\nDELTAS (after - before):')
console.log('  Hips (want 0,-0.1,0):     ', drift(before.hips, after.hips))
console.log('  Foot.L (want 0,0,0):      ', drift(before.footL, after.footL))
console.log('  Foot.R (want 0,0,0):      ', drift(before.footR, after.footR))
console.log('  Upper Leg.L (any change?):', drift(before.upperLegL, after.upperLegL))
console.log('  Lower Leg.L (any change?):', drift(before.lowerLegL, after.lowerLegL))

await browser.close()

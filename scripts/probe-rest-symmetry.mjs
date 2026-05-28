import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(3500)
const info = await page.evaluate(() => {
  const ed = window.__editor
  const initial = ed.getInitialAnchor()
  if (!initial) return { error: 'no initial' }
  const rest = initial.rotations  // bone → [x,y,z,w]
  // Paired bones to check
  const pairs = [
    ['Shoulder.L', 'Shoulder.R'],
    ['Upper Arm.L', 'Upper Arm.R'],
    ['Lower Arm.L', 'Lower Arm.R'],
    ['Hand.L', 'Hand.R'],
    ['Upper Leg.L', 'Upper Leg.R'],
    ['Lower Leg.L', 'Lower Leg.R'],
    ['Foot.L', 'Foot.R'],
  ]
  // Standard mirror formula: (x, y, z, w) → (x, -y, -z, w)
  const mirror = (q) => [q[0], -q[1], -q[2], q[3]]
  const out = []
  for (const [L, R] of pairs) {
    const qL = rest[L]
    const qR = rest[R]
    if (!qL || !qR) { out.push({ pair: [L, R], missing: true }); continue }
    const mR = mirror(qR)
    // delta = qL - mR component-wise
    const d = [qL[0]-mR[0], qL[1]-mR[1], qL[2]-mR[2], qL[3]-mR[3]]
    const absMax = Math.max(...d.map(Math.abs))
    out.push({
      pair: [L, R],
      qL: qL.map(x => +x.toFixed(3)),
      qR: qR.map(x => +x.toFixed(3)),
      mirrorOfR: mR.map(x => +x.toFixed(3)),
      maxDiff: +absMax.toFixed(3),
      symmetric: absMax < 0.01,
    })
  }
  // Also dump some midline bones for context
  const midline = ['Hips', 'Spine', 'Chest', 'Neck', 'Head']
  const mid = {}
  for (const b of midline) mid[b] = rest[b]?.map(x => +x.toFixed(3))
  return { pairs: out, midline: mid }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

// Headless QA runner: opens the dev server, switches to editor camera,
// optionally toggles the model variant, takes a screenshot.
//
// Usage:
//   node scripts/qa-knight.mjs knight   # screenshot of GLB knight
//   node scripts/qa-knight.mjs custom   # screenshot of code-built knight

import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BASE = 'http://192.168.1.76:5173'
const OUT_DIR = join(__dirname, 'qa-screenshots')

const variant = process.argv[2] ?? 'custom'
if (!['knight', 'custom'].includes(variant)) {
  console.error(`bad variant: ${variant}`)
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 } })
const page = await ctx.newPage()

page.on('pageerror', (err) => console.error('[page error]', err.message))
page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('[console]', msg.text())
})

await page.goto(BASE, { waitUntil: 'domcontentloaded' })

// Wait until the editor is ready
await page.waitForFunction(
  () => Boolean((window).__editor && (window).__bjs),
  { timeout: 15000 },
)

// Switch to editor camera + hide bone-picker spheres for clean shot.
const debug = await page.evaluate(() => {
  ;(window).__bjs.setCameraMode('editor')
  ;(window).__editor.setBonePickerActive?.(false)
  return {
    activeCam: (window).__bjs.scene.activeCamera?.name,
    models: (window).__editor.getModels?.(),
  }
})
console.log('debug:', JSON.stringify(debug))
await page.waitForTimeout(800)

const out = join(OUT_DIR, `${variant}.png`)
await page.screenshot({ path: out })
console.log(`saved → ${out}`)

await browser.close()

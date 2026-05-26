import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
page.on('console', m => m.text().includes('[probe]') && console.log(m.text()))
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const meshes = scene.meshes.filter(m => m.name.includes('copper_axe') || m.name.includes('__preview_copper'))
  return meshes.map(m => ({
    name: m.name,
    totalVertices: m.getTotalVertices(),
    primitives: scene.meshes.filter(x => x.name.startsWith(m.name)).length,
    hasPositions: !!m.getVerticesData('position'),
    hasNormals: !!m.getVerticesData('normal'),
    hasColors: !!m.getVerticesData('color'),
    hasUVs: !!m.getVerticesData('uv'),
    colorSampleFirst: (() => {
      const c = m.getVerticesData('color')
      if (!c) return null
      return [c[0], c[1], c[2], c[3]]
    })(),
    colorSampleMiddle: (() => {
      const c = m.getVerticesData('color')
      if (!c) return null
      const mid = Math.floor(c.length / 8) * 4
      return [c[mid], c[mid+1], c[mid+2], c[mid+3]]
    })(),
    materialName: m.material?.name,
    materialClass: m.material?.constructor?.name,
    materialDiffuse: m.material?.diffuseColor ? [m.material.diffuseColor.r.toFixed(2), m.material.diffuseColor.g.toFixed(2), m.material.diffuseColor.b.toFixed(2)] : null,
    materialAlbedo: m.material?.albedoColor ? [m.material.albedoColor.r.toFixed(2), m.material.albedoColor.g.toFixed(2), m.material.albedoColor.b.toFixed(2)] : null,
    materialUseVertexColors: m.material?.useVertexColors,
  }))
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

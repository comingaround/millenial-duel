import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await (await browser.newContext()).newPage()
await page.goto('http://192.168.1.76:5173', { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => Boolean(window.__editor && window.__bjs), { timeout: 25000 })
await page.waitForTimeout(2500)
const info = await page.evaluate(() => {
  const scene = window.__bjs.scene
  const mesh = scene.meshes.find(m => m.name.includes('__preview_copper_axe'))
  const mat = mesh?.material
  if (!mat) return { error: 'no mat' }
  // Sample vertex color range — find min/max to see if values vary.
  const c = mesh.getVerticesData('color')
  let minR=2,minG=2,minB=2,maxR=-1,maxG=-1,maxB=-1
  if (c) for (let i = 0; i < c.length; i += 4) {
    if (c[i]<minR) minR=c[i]; if (c[i+1]<minG) minG=c[i+1]; if (c[i+2]<minB) minB=c[i+2]
    if (c[i]>maxR) maxR=c[i]; if (c[i+1]>maxG) maxG=c[i+1]; if (c[i+2]>maxB) maxB=c[i+2]
  }
  return {
    name: mat.name,
    class: mat.constructor.name,
    hasAlbedoTexture: !!mat.albedoTexture,
    albedoTextureUrl: mat.albedoTexture?.url ?? mat.albedoTexture?.name ?? null,
    hasMetallicTexture: !!mat.metallicTexture,
    hasReflectivityTexture: !!mat.reflectivityTexture,
    hasEmissiveTexture: !!mat.emissiveTexture,
    hasBumpTexture: !!mat.bumpTexture,
    metallic: mat.metallic,
    roughness: mat.roughness,
    useVertexColors: mat.useVertexColors,
    vertexColorRange: { minR: minR.toFixed(2), maxR: maxR.toFixed(2), minG: minG.toFixed(2), maxG: maxG.toFixed(2), minB: minB.toFixed(2), maxB: maxB.toFixed(2) },
    rangeSpread: Math.max(maxR-minR, maxG-minG, maxB-minB).toFixed(2),
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()

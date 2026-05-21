import {
  Color3,
  DynamicTexture,
  Engine,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

// Pale yellow-white haze at the horizon.
export const HORIZON_COLOR = new Color3(0.92, 0.89, 0.78)
const HORIZON_HEX = '#EBE3C8'
const HORIZON_PALE_HEX = '#D7DDDA'

// Sun world position — in front of default camera view, ~18° elevation.
export const SUN_POSITION = new Vector3(35, 75, 240)

export function createSky(scene: Scene) {
  const sky = MeshBuilder.CreateSphere(
    'sky',
    { diameter: 2000, segments: 24, sideOrientation: Mesh.BACKSIDE },
    scene,
  )
  sky.infiniteDistance = true
  sky.isPickable = false
  sky.applyFog = false
  sky.renderingGroupId = 0

  const mat = new StandardMaterial('skyMat', scene)
  mat.backFaceCulling = false
  mat.disableLighting = true
  mat.diffuseColor = new Color3(0, 0, 0)
  mat.specularColor = new Color3(0, 0, 0)

  const W = 4
  const H = 512
  const tex = new DynamicTexture(
    'skyGrad',
    { width: W, height: H },
    scene,
    false,
  )
  const ctx = tex.getContext()
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0.0,  '#1B5BAA')
  grad.addColorStop(0.25, '#3A78C0')
  grad.addColorStop(0.55, '#7AA8D6')
  grad.addColorStop(0.78, '#B4CADC')
  grad.addColorStop(0.92, HORIZON_PALE_HEX)
  grad.addColorStop(1.0,  HORIZON_HEX)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
  tex.update(false)
  tex.hasAlpha = false

  mat.emissiveTexture = tex
  sky.material = mat
  return sky
}

// Sun = two billboard planes (always face camera) with radial-alpha
// gradient textures. Alpha fades 1 → 0 outward → seamless glow.
export function createSun(scene: Scene) {
  // --- Halo: wide soft warm glow ---
  const haloTex = new DynamicTexture(
    'sunHaloTex',
    { width: 512, height: 512 },
    scene,
    true,
  )
  haloTex.hasAlpha = true
  const hctx = haloTex.getContext() as CanvasRenderingContext2D
  hctx.clearRect(0, 0, 512, 512)
  const haloGrad = hctx.createRadialGradient(256, 256, 0, 256, 256, 256)
  haloGrad.addColorStop(0.0,  'rgba(255, 248, 215, 1.0)')
  haloGrad.addColorStop(0.10, 'rgba(255, 240, 195, 0.85)')
  haloGrad.addColorStop(0.25, 'rgba(255, 230, 175, 0.55)')
  haloGrad.addColorStop(0.45, 'rgba(255, 220, 160, 0.25)')
  haloGrad.addColorStop(0.70, 'rgba(255, 215, 150, 0.08)')
  haloGrad.addColorStop(1.0,  'rgba(255, 215, 150, 0.0)')
  hctx.fillStyle = haloGrad
  hctx.fillRect(0, 0, 512, 512)
  haloTex.update(false)

  const halo = MeshBuilder.CreatePlane(
    'sunHalo',
    { width: 90, height: 90 },
    scene,
  )
  halo.position = SUN_POSITION
  halo.billboardMode = Mesh.BILLBOARDMODE_ALL
  halo.isPickable = false
  halo.applyFog = false
  halo.renderingGroupId = 1

  const haloMat = new StandardMaterial('sunHaloMat', scene)
  haloMat.diffuseTexture = haloTex
  haloMat.diffuseTexture.hasAlpha = true
  haloMat.useAlphaFromDiffuseTexture = true
  haloMat.emissiveColor = new Color3(1, 1, 1)
  haloMat.specularColor = new Color3(0, 0, 0)
  haloMat.disableLighting = true
  haloMat.backFaceCulling = false
  haloMat.disableDepthWrite = true
  haloMat.alphaMode = Engine.ALPHA_COMBINE
  halo.material = haloMat

  // --- Core: small bright disc ---
  const coreTex = new DynamicTexture(
    'sunCoreTex',
    { width: 256, height: 256 },
    scene,
    true,
  )
  coreTex.hasAlpha = true
  const cctx = coreTex.getContext() as CanvasRenderingContext2D
  cctx.clearRect(0, 0, 256, 256)
  const coreGrad = cctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  coreGrad.addColorStop(0.0, 'rgba(255, 253, 240, 1.0)')
  coreGrad.addColorStop(0.4, 'rgba(255, 248, 215, 0.95)')
  coreGrad.addColorStop(0.7, 'rgba(255, 240, 190, 0.5)')
  coreGrad.addColorStop(1.0, 'rgba(255, 230, 170, 0.0)')
  cctx.fillStyle = coreGrad
  cctx.fillRect(0, 0, 256, 256)
  coreTex.update(false)

  const core = MeshBuilder.CreatePlane(
    'sunCore',
    { width: 22, height: 22 },
    scene,
  )
  core.position = SUN_POSITION
  core.billboardMode = Mesh.BILLBOARDMODE_ALL
  core.isPickable = false
  core.applyFog = false
  core.renderingGroupId = 1

  const coreMat = new StandardMaterial('sunCoreMat', scene)
  coreMat.diffuseTexture = coreTex
  coreMat.diffuseTexture.hasAlpha = true
  coreMat.useAlphaFromDiffuseTexture = true
  coreMat.emissiveColor = new Color3(1, 1, 1)
  coreMat.specularColor = new Color3(0, 0, 0)
  coreMat.disableLighting = true
  coreMat.backFaceCulling = false
  coreMat.disableDepthWrite = true
  coreMat.alphaMode = Engine.ALPHA_COMBINE
  core.material = coreMat

  return { core, halo }
}

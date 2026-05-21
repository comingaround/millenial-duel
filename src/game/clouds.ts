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

// Build one cloud texture — a few overlapping soft-edged blobs, all
// with radial alpha fade so edges are seamless. Each cloud gets its
// own randomized texture so they don't look identical.
function makeCloudTexture(scene: Scene, key: string): DynamicTexture {
  const W = 512
  const H = 256
  const tex = new DynamicTexture(
    `cloudTex_${key}`,
    { width: W, height: H },
    scene,
    true,
  )
  tex.hasAlpha = true
  const ctx = tex.getContext() as CanvasRenderingContext2D
  ctx.clearRect(0, 0, W, H)

  // 5-9 overlapping puffs forming an irregular cloud shape
  const puffCount = 5 + Math.floor(Math.random() * 5)
  for (let i = 0; i < puffCount; i++) {
    const cx = W * (0.2 + Math.random() * 0.6)
    const cy = H * (0.35 + Math.random() * 0.35)
    const r = 60 + Math.random() * 80
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.95)')
    grad.addColorStop(0.4, 'rgba(255, 255, 255, 0.55)')
    grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.18)')
    grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)')
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
  }
  tex.update(false)
  return tex
}

// Cloud field: ~10 large translucent billboard quads scattered above
// the playable area. Each is a unique randomized puff texture.
export function createClouds(scene: Scene) {
  const COUNT = 10
  const ALTITUDE = 140    // height above ground
  const SPREAD = 700      // horizontal radius around origin
  const clouds: Mesh[] = []

  for (let i = 0; i < COUNT; i++) {
    const tex = makeCloudTexture(scene, String(i))

    // Random size — clouds vary from medium to large
    const w = 180 + Math.random() * 220
    const h = w * 0.5 * (0.8 + Math.random() * 0.4)  // wider than tall

    const cloud = MeshBuilder.CreatePlane(
      `cloud_${i}`,
      { width: w, height: h },
      scene,
    )

    // Scatter in a ring around origin (avoid clouds directly overhead
    // near the camera) — use polar coords for even distribution
    const theta = (i / COUNT) * Math.PI * 2 + (Math.random() - 0.5) * 0.6
    const dist = SPREAD * (0.45 + Math.random() * 0.55)
    cloud.position = new Vector3(
      Math.cos(theta) * dist,
      ALTITUDE + (Math.random() - 0.5) * 50,
      Math.sin(theta) * dist,
    )

    cloud.billboardMode = Mesh.BILLBOARDMODE_ALL
    cloud.isPickable = false
    cloud.applyFog = false
    cloud.renderingGroupId = 1   // after sky, with sun

    const mat = new StandardMaterial(`cloudMat_${i}`, scene)
    mat.diffuseTexture = tex
    mat.diffuseTexture.hasAlpha = true
    mat.useAlphaFromDiffuseTexture = true
    mat.emissiveColor = new Color3(1, 1, 1)
    mat.specularColor = new Color3(0, 0, 0)
    mat.disableLighting = true
    mat.backFaceCulling = false
    mat.disableDepthWrite = true
    mat.alphaMode = Engine.ALPHA_COMBINE
    cloud.material = mat

    clouds.push(cloud)
  }

  return clouds
}

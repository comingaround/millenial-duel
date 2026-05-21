import {
  Color3,
  DynamicTexture,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Texture,
} from '@babylonjs/core'

export function createGround(scene: Scene) {
  const ground = MeshBuilder.CreateGround(
    'ground',
    { width: 4000, height: 4000, subdivisions: 4 },
    scene,
  )

  const mat = new StandardMaterial('groundMat', scene)
  mat.diffuseColor = new Color3(1, 1, 1)            // texture sets color
  mat.specularColor = new Color3(0.02, 0.02, 0.02)  // matte
  mat.ambientColor = new Color3(0.45, 0.55, 0.35)

  // Hand-painted grass texture — vivid base + small flecks.
  const tex = new DynamicTexture(
    'grassTex',
    { width: 1024, height: 1024 },
    scene,
    true,
  )
  const ctx = tex.getContext()

  // Base — vivid grass green (closer to reference)
  ctx.fillStyle = '#5BA236'
  ctx.fillRect(0, 0, 1024, 1024)

  // Lighter highlight flecks
  for (let i = 0; i < 6000; i++) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    const w = 1 + Math.random() * 2
    const h = 2 + Math.random() * 4
    const a = 0.25 + Math.random() * 0.35
    ctx.fillStyle = `rgba(150, 200, 90, ${a})`
    ctx.fillRect(x, y, w, h)
  }
  // Darker shadowed-blade flecks
  for (let i = 0; i < 5000; i++) {
    const x = Math.random() * 1024
    const y = Math.random() * 1024
    const w = 1 + Math.random() * 2
    const h = 2 + Math.random() * 4
    const a = 0.25 + Math.random() * 0.4
    ctx.fillStyle = `rgba(45, 80, 25, ${a})`
    ctx.fillRect(x, y, w, h)
  }
  tex.update(false)
  tex.wrapU = Texture.WRAP_ADDRESSMODE
  tex.wrapV = Texture.WRAP_ADDRESSMODE
  tex.uScale = 120
  tex.vScale = 120

  mat.diffuseTexture = tex

  ground.material = mat
  ground.receiveShadows = true
  ground.isPickable = false
  return ground
}

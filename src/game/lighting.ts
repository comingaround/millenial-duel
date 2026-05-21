import {
  Color3,
  DirectionalLight,
  HemisphericLight,
  Scene,
  Vector3,
} from '@babylonjs/core'

export function setupLighting(scene: Scene) {
  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.55
  hemi.diffuse = new Color3(1.0, 0.98, 0.92)
  hemi.groundColor = new Color3(0.35, 0.4, 0.3)

  const sun = new DirectionalLight('sun', new Vector3(-0.5, -1.0, -0.3), scene)
  sun.position = new Vector3(20, 30, 10)
  sun.intensity = 1.1
  sun.diffuse = new Color3(1.0, 0.95, 0.85)
}

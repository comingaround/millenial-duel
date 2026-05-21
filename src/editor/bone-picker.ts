import {
  Color3,
  Mesh,
  MeshBuilder,
  Observer,
  PointerInfo,
  Scene,
  Skeleton,
  StandardMaterial,
} from '@babylonjs/core'

export type BonePicker = {
  setActive: (active: boolean) => void
  setSelected: (boneName: string | null) => void
  onSelect: (cb: (boneName: string) => void) => void
  dispose: () => void
}

// Creates a sphere only at bones in `activeBones` whitelist. Click to pick.
// Selected sphere turns red, others stay yellow.
export function createBonePicker(
  scene: Scene,
  skeleton: Skeleton,
  activeBones: readonly string[],
): BonePicker {
  const yellow = new StandardMaterial('bone_picker_yellow', scene)
  yellow.diffuseColor = new Color3(1.0, 0.85, 0.2)
  yellow.emissiveColor = new Color3(0.6, 0.5, 0.1)
  yellow.specularColor = new Color3(0, 0, 0)
  yellow.alpha = 0.7

  const red = new StandardMaterial('bone_picker_red', scene)
  red.diffuseColor = new Color3(0.95, 0.18, 0.18)
  red.emissiveColor = new Color3(0.5, 0.08, 0.08)
  red.specularColor = new Color3(0, 0, 0)
  red.alpha = 0.85

  // Map bone name → sphere mesh
  const spheres = new Map<string, Mesh>()
  for (const boneName of activeBones) {
    const bone = skeleton.bones.find((b) => b.name === boneName)
    const node = bone?._linkedTransformNode
    if (!node) continue
    const sphere = MeshBuilder.CreateSphere(
      `pick__${boneName}`,
      { diameter: 0.07, segments: 10 },
      scene,
    )
    sphere.material = yellow
    sphere.isPickable = true
    sphere.renderingGroupId = 2
    sphere.metadata = { boneName }
    sphere.setEnabled(false)
    spheres.set(boneName, sphere)
  }

  // Sync sphere positions to bone world positions every frame
  const onBeforeRender = () => {
    for (const [boneName, sphere] of spheres) {
      if (!sphere.isEnabled()) continue
      const bone = skeleton.bones.find((b) => b.name === boneName)
      const node = bone?._linkedTransformNode
      if (!node) continue
      node.computeWorldMatrix(true)
      sphere.position.copyFrom(node.getAbsolutePosition())
    }
  }
  scene.onBeforeRenderObservable.add(onBeforeRender)

  const subscribers: Array<(name: string) => void> = []
  let pointerObserver: Observer<PointerInfo> | null = null
  let currentSelection: string | null = null

  const setSphereSelected = (boneName: string | null) => {
    // Reset previous to yellow
    if (currentSelection) {
      const prev = spheres.get(currentSelection)
      if (prev) prev.material = yellow
    }
    currentSelection = boneName
    if (boneName) {
      const next = spheres.get(boneName)
      if (next) next.material = red
    }
  }

  const handlePointer = (info: PointerInfo) => {
    if (info.type !== 1) return // POINTERDOWN
    const picked = info.pickInfo?.pickedMesh
    const meta = picked?.metadata as { boneName?: string } | undefined
    if (meta?.boneName) {
      for (const cb of subscribers) cb(meta.boneName)
    }
  }

  let active = false
  return {
    setActive: (a: boolean) => {
      if (a === active) return
      active = a
      for (const s of spheres.values()) s.setEnabled(a)
      if (a) {
        pointerObserver = scene.onPointerObservable.add(handlePointer)
      } else if (pointerObserver) {
        scene.onPointerObservable.remove(pointerObserver)
        pointerObserver = null
        // Clear selection visual on deactivate
        setSphereSelected(null)
      }
    },
    setSelected: (boneName) => setSphereSelected(boneName),
    onSelect: (cb) => {
      subscribers.push(cb)
    },
    dispose: () => {
      scene.onBeforeRenderObservable.removeCallback(onBeforeRender)
      if (pointerObserver) scene.onPointerObservable.remove(pointerObserver)
      for (const s of spheres.values()) s.dispose()
      yellow.dispose()
      red.dispose()
    },
  }
}

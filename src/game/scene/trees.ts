import '@babylonjs/loaders/glTF'
import {
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

// Bake-in colors (FBX→GLB lost the original colors, only kept a 1×1 PNG
// placeholder, so we override every primitive's material).
const TRUNK_COLOR = new Color3(0.30, 0.23, 0.19)
const CANOPY_COLOR = new Color3(0.34, 0.62, 0.28)

export function createTrees(scene: Scene) {
  SceneLoader.ImportMeshAsync('', '/models/', 'trees.glb', scene)
    .then((result) => {
      const root =
        result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]

      root.position = new Vector3(0, 0, 8)
      root.rotation = new Vector3(0, Math.PI / 2, 0)  // spread row across view
      root.scaling = new Vector3(0.18, 0.18, 0.18)

      // Build per-tree primitive groups by prefix (Cylinder.NNN_primitiveX)
      const byTree = new Map<string, Mesh[]>()
      for (const m of result.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
        const match = m.name.match(/^(Cylinder\.\d+)/)
        if (!match) continue
        const key = match[1]
        const arr = byTree.get(key) ?? []
        arr.push(m)
        byTree.set(key, arr)
      }

      // For each tree: lower primitive (smaller max Y) = trunk, higher = canopy.
      const trunkMat = new StandardMaterial('glb_trunk_mat', scene)
      trunkMat.diffuseColor = TRUNK_COLOR
      trunkMat.specularColor = new Color3(0.02, 0.02, 0.02)

      const canopyMat = new StandardMaterial('glb_canopy_mat', scene)
      canopyMat.diffuseColor = CANOPY_COLOR
      canopyMat.specularColor = new Color3(0.02, 0.02, 0.02)

      for (const prims of byTree.values()) {
        prims.sort(
          (a, b) =>
            a.getBoundingInfo().boundingBox.maximumWorld.y -
            b.getBoundingInfo().boundingBox.maximumWorld.y,
        )
        prims[0].material = trunkMat
        if (prims[1]) prims[1].material = canopyMat
        for (const p of prims) p.convertToFlatShadedMesh()
      }

      console.log('[trees] loaded', byTree.size, 'trees')
    })
    .catch((err) => {
      console.error('[trees] load failed', err)
    })
}

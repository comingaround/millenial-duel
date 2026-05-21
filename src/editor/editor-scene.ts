import '@babylonjs/loaders/glTF'
import {
  AbstractMesh,
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  Skeleton,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

// Standalone editor knight, isolated from the duel scene.
const POSITION = new Vector3(50, 0, 0)

// Active bones: combat-relevant subset of the rig.
//   Torso/head — Hips (whole-body lean), Spine, Chest, Neck, Head
//   Shoulders  — clavicle bones, for shrug + arm-base placement
//   Arms       — Upper Arm / Lower Arm / Hand
//   Legs       — Upper Leg / Lower Leg / Foot
// Skipped: Fingers, Thumbs, Hand Hold (weapon attach), Toes, IK helpers.
export const ACTIVE_BONES: readonly string[] = [
  // torso + head (5)
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  // arms (8 incl. clavicles)
  'Shoulder.L',
  'Shoulder.R',
  'Upper Arm.L',
  'Upper Arm.R',
  'Lower Arm.L',
  'Lower Arm.R',
  'Hand.L',
  'Hand.R',
  // legs (6)
  'Upper Leg.L',
  'Upper Leg.R',
  'Lower Leg.L',
  'Lower Leg.R',
  'Foot.L',
  'Foot.R',
]

// Same color palette as the rest of the project for visual consistency.
const MAT_COLORS: Record<string, Color3> = {
  'Blade':            new Color3(0.78, 0.80, 0.86),
  'Blade highlight':  new Color3(0.94, 0.95, 0.98),
  'Wood':             new Color3(0.50, 0.32, 0.18),
  'Emblem':           new Color3(0.74, 0.15, 0.15),
  'Metal':            new Color3(0.62, 0.50, 0.22),
  'Metal Dark':       new Color3(0.18, 0.20, 0.24),
  'Metal_dark':       new Color3(0.32, 0.34, 0.40),
  'Metal.002':        new Color3(0.58, 0.62, 0.70),
  'Skin':             new Color3(0.94, 0.78, 0.66),
  'Hair':             new Color3(0.30, 0.20, 0.12),
  'Shirt':            new Color3(0.70, 0.66, 0.58),
  'Shoe':             new Color3(0.38, 0.28, 0.18),
  'Pants.001':        new Color3(0.40, 0.30, 0.20),
  'Underclothes.001': new Color3(0.42, 0.22, 0.20),
  'Black':            new Color3(0.20, 0.21, 0.24),
}
const FALLBACK = new Color3(0.55, 0.55, 0.55)

export type EditorSceneApi = {
  root: AbstractMesh
  skeleton: Skeleton          // primary skeleton (for bone lookup)
  skeletons: Skeleton[]       // all 8 (need prepare() on each)
  allBoneNames: string[]      // full list for the panel
  restPose: Record<string, [number, number, number, number]>
  position: Vector3
  animationGroups: any[]      // baked anims from the GLB
}

export function createEditorScene(scene: Scene): Promise<EditorSceneApi | null> {
  return SceneLoader.ImportMeshAsync('', '/models/', 'knight.glb', scene)
    .then((result) => {
      const root =
        result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]
      root.name = 'editor_knight'
      root.position = POSITION.clone()
      root.scaling = root.scaling.scale(1.2)

      // Material override + make all meshes non-pickable so only the
      // bone-picker spheres receive clicks.
      const matCache = new Map<string, StandardMaterial>()
      for (const m of result.meshes) {
        m.isPickable = false
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
        if (!m.material) continue
        const matName = m.material.name
        let mat = matCache.get(matName)
        if (!mat) {
          mat = new StandardMaterial(`editor_${matName}`, scene)
          mat.diffuseColor = MAT_COLORS[matName] ?? FALLBACK
          mat.specularColor = new Color3(0.10, 0.10, 0.12)
          mat.ambientColor = (MAT_COLORS[matName] ?? FALLBACK).scale(0.5)
          matCache.set(matName, mat)
        }
        m.material = mat
      }

      // Editor knight stays in rest pose — but keep the baked anim groups
      // around so users can import them as anchors via the editor UI.
      result.animationGroups.forEach((g) => g.stop())

      // The Knight GLB has 8 skeletons sharing TransformNodes (one per mesh
      // group). All need prepare() every frame for bone edits to refresh
      // the skinning matrices reliably.
      const allSkeletons = new Set<Skeleton>()
      scene.meshes.forEach((m) => {
        if (!m.skeleton) return
        let p: any = m
        while (p) {
          if (p === root) {
            allSkeletons.add(m.skeleton)
            break
          }
          p = p.parent
        }
      })
      const skeletons = Array.from(allSkeletons)
      const skeleton = result.skeletons[0]

      scene.onBeforeRenderObservable.add(() => {
        for (const s of skeletons) s.prepare()
      })

      const allBoneNames = skeleton.bones.map((b) => b.name)

      // Capture rest pose
      const restPose: Record<string, [number, number, number, number]> = {}
      for (const bone of skeleton.bones) {
        const node = bone._linkedTransformNode
        if (!node) continue
        node.rotationQuaternion =
          node.rotationQuaternion ?? node.rotation.toQuaternion()
        const q = node.rotationQuaternion
        restPose[bone.name] = [q.x, q.y, q.z, q.w]
      }

      console.log(
        `[editor] knight loaded — ${skeleton.bones.length} bones, ${skeletons.length} skins`,
      )
      return {
        root,
        skeleton,
        skeletons,
        allBoneNames,
        restPose,
        position: POSITION.clone(),
        animationGroups: result.animationGroups,
      }
    })
    .catch((err) => {
      console.error('[editor] load failed', err)
      return null
    })
}

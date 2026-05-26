import '@babylonjs/loaders/glTF'
import {
  AbstractMesh,
  Color3,
  Material,
  Matrix,
  Mesh,
  Scene,
  SceneLoader,
  Skeleton,
  StandardMaterial,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core'
import { POSITION_BONES } from './pose-store'

// Editor knight area — two instances facing each other for combat practice.
// Model 1 keeps the original editor-knight world position (50, 0, 0); Model 2
// stands ~1.5m to the +X side. Both face each other along the X axis.
// (Knight's natural forward direction in the GLB is -Z, so rotations here
// orient that local axis to face the other model.)
const MODEL1_POSITION = new Vector3(50.0, 0, 0)
const MODEL2_POSITION = new Vector3(51.5, 0, 0)   // 1.5m gap
// Model 3 ("Custom") — character-creator target. Skeleton-only knight
// (all GLB meshes hidden) so the user builds the body part-by-part by
// attaching geometric primitives via the Creator tab.
const MODEL3_POSITION = new Vector3(53.0, 0, 0)   // 1.5m from Model 2
const MODEL1_YROT = -Math.PI / 2     // local -Z → +X (faces Model 2)
const MODEL2_YROT =  Math.PI / 2     // local -Z → -X (faces Model 1)
const MODEL3_YROT = -Math.PI / 2     // faces +X (same as Model 1)

// Active bones: combat-relevant subset of the rig.
//   Torso/head — Hips (whole-body lean), Spine, Chest, Neck, Head
//   Shoulders  — clavicle bones, for shrug + arm-base placement
//   Arms       — Upper Arm / Lower Arm / Hand
//   Legs       — Upper Leg / Lower Leg / Foot
// Skipped: Fingers, Thumbs, Hand Hold (weapon attach), Toes, IK helpers.
export const ACTIVE_BONES: readonly string[] = [
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'Shoulder.L',
  'Shoulder.R',
  'Upper Arm.L',
  'Upper Arm.R',
  'Lower Arm.L',
  'Lower Arm.R',
  'Hand.L',
  'Hand.R',
  'Upper Leg.L',
  'Upper Leg.R',
  'Lower Leg.L',
  'Lower Leg.R',
  'Foot.L',
  'Foot.R',
]

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

// One knight instance — has its own root, skeleton(s), rest data, and meshes.
// Anchors / animations are applied per-instance via the engine's active-model
// selector. Materials are shared via a single matCache passed in (so both
// instances render with the same colors and the Style panel affects both).
// One Creator part — a geometric primitive parented to a bone on the
// Custom model. Author by adding/resizing via the Creator tab.
// 'clone' = mimic the actual mesh geometry on a Model 1 bone (triangles
// extracted by skinning weights, baked into bone-local space, then
// re-parented to the Custom model's same-named bone). All other shapes
// are procedural primitives.
export type CreatorShape = 'sphere' | 'box' | 'cylinder' | 'capsule' | 'clone'
export type CreatorPart = {
  id: string
  boneName: string                   // bone the part is attached to on Custom
  shape: CreatorShape
  scale: [number, number, number]    // dimensions in metres (in bone-local frame)
  offset: [number, number, number]   // local position relative to bone
  rotation: [number, number, number] // Euler degrees (X, Y, Z)
  color: string                      // hex #rrggbb
  // When set, this part clones a NON-skinned prop mesh (e.g. sword,
  // shield) from the source model by name, rather than extracting
  // skinned geometry by bone. boneName is still required — used as the
  // attachment point on Custom (typically the prop's parent bone in source).
  sourceMeshName?: string
  // When set, this part is a GROUP — one TransformNode parented to bone,
  // with N child meshes (one per listed source-mesh name) nested under it.
  // Transform/color edits apply to the whole group. Used for multi-primitive
  // props like a sword (blade + grip + pommel + crossguard).
  groupMeshNames?: string[]
}

// Runtime state for one creator part: data + the Babylon objects it owns.
// Each part owns its own material (NOT shared) so its color is independent.
//
// For group parts, `mesh` is a transform-node-shaped Mesh (no geometry) used
// as the shared parent; `material` is the first child's material. The full
// child list lives in `groupChildren` so disposal + color updates can iterate.
export type CreatorPartInstance = {
  data: CreatorPart
  mesh: Mesh
  // Material may be StandardMaterial (primitives + flat clones) OR a
  // PBRMaterial clone (textured-prop clones that need to keep the
  // source's albedoTexture, metallic/roughness, normal map, etc).
  material: Material
  groupChildren?: Array<{ mesh: Mesh; material: Material }>
}

export type ModelInstance = {
  name: string
  root: AbstractMesh
  skeleton: Skeleton           // primary skeleton for bone lookups
  skeletons: Skeleton[]        // all 8 (need prepare() each frame)
  glbMeshes: AbstractMesh[]
  restPose: Record<string, [number, number, number, number]>
  restPositions: Record<string, [number, number, number]>
  restWorldPositions: Record<string, [number, number, number]>
  // Snapshotted at load (before any user pose). Used by the Creator's
  // 'clone' shape to express Model 1's skinned vertices in bone-local
  // space at rest. Keyed by bone name / mesh uniqueId respectively.
  restBoneWorldMatrices: Map<string, Matrix>
  restMeshWorldMatrices: Map<number, Matrix>
  position: Vector3            // initial world position (for Reset)
  // Map<partId, instance> — only populated on the Custom model.
  creatorParts: Map<string, CreatorPartInstance>
}

// Weapon library — GLB props loaded from public/models/weapons/. Each
// entry has the source meshes stashed at scene-graph leaves (parented to
// a hidden TransformNode) so Babylon's normal lifecycle disposes them on
// engine teardown. The Creator pulls geometry from these meshes via the
// existing prop-clone path.
export type WeaponLibraryEntry = {
  stem: string         // base name (e.g. "copper_axe")
  meshes: Mesh[]       // renderable sub-meshes (1 or more primitives)
  kind: 'axe' | 'sword' | 'shield' | 'bow' | 'dagger' | 'hammer' | 'mace' | 'other'
}

export type EditorSceneApi = {
  models: ModelInstance[]      // [Model 1, Model 2, Custom, …]
  allBoneNames: string[]       // shared (same rig)
  animationGroups: any[]       // baked anims from the first GLB load
  weaponLibrary: WeaponLibraryEntry[]
  // Spawn a fresh knight instance at runtime. Used by the "+ Add" button
  // in the left dashboard. Appends to `models` and returns the new index.
  addModel: (name: string, position: Vector3, yRotation: number, hideAllMeshes?: boolean) => Promise<number>
}

async function loadKnightInstance(
  scene: Scene,
  matCache: Map<string, StandardMaterial>,
  name: string,
  position: Vector3,
  yRotation: number,
  hideAllMeshes = false,
): Promise<ModelInstance> {
  const result = await SceneLoader.ImportMeshAsync('', '/models/', 'knight.glb', scene)
  const root =
    result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]
  root.name = name
  root.position = position.clone()
  root.scaling = root.scaling.scale(1.2)
  root.rotation = new Vector3(0, yRotation, 0)

  // Materials — shared across all instances via matCache
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
      mat.backFaceCulling = false
      matCache.set(matName, mat)
    }
    m.material = mat
  }

  // For the Custom model: hide every renderable mesh so only the skeleton
  // (bone-picker spheres) is visible. Bones stay intact — skinning data
  // and TransformNodes are unaffected by mesh visibility.
  if (hideAllMeshes) {
    for (const m of result.meshes) {
      if (m instanceof Mesh && m.getTotalVertices() > 0) m.isVisible = false
    }
  }

  result.animationGroups.forEach((g) => g.stop())

  // Find all skeletons under THIS instance's root (sharing TransformNodes).
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

  // Per-instance per-frame prepare() for multi-skin matrix refresh
  scene.onBeforeRenderObservable.add(() => {
    for (const s of skeletons) s.prepare()
  })

  // Capture rest pose for this instance
  const restPose: Record<string, [number, number, number, number]> = {}
  const restPositions: Record<string, [number, number, number]> = {}
  const restWorldPositions: Record<string, [number, number, number]> = {}
  const restBoneWorldMatrices = new Map<string, Matrix>()
  const restMeshWorldMatrices = new Map<number, Matrix>()
  root.computeWorldMatrix(true)
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    node.rotationQuaternion =
      node.rotationQuaternion ?? node.rotation.toQuaternion()
    const q = node.rotationQuaternion
    restPose[bone.name] = [q.x, q.y, q.z, q.w]
    node.computeWorldMatrix(true)
    restBoneWorldMatrices.set(bone.name, node.getWorldMatrix().clone())
    if (POSITION_BONES.includes(bone.name)) {
      const p = node.position
      restPositions[bone.name] = [p.x, p.y, p.z]
      const wp = node.getAbsolutePosition()
      restWorldPositions[bone.name] = [wp.x, wp.y, wp.z]
    }
  }
  // Capture every loaded mesh's world matrix at rest — Creator's 'clone'
  // shape needs to convert mesh-local vertex positions → world → bone-local.
  for (const m of result.meshes) {
    m.computeWorldMatrix(true)
    restMeshWorldMatrices.set(m.uniqueId, m.getWorldMatrix().clone())
  }

  return {
    name,
    root,
    skeleton,
    skeletons,
    glbMeshes: result.meshes,
    restPose,
    restPositions,
    restWorldPositions,
    restBoneWorldMatrices,
    restMeshWorldMatrices,
    position: position.clone(),
    creatorParts: new Map<string, CreatorPartInstance>(),
  }
}

export async function createEditorScene(scene: Scene): Promise<EditorSceneApi | null> {
  try {
    // Shared material cache — both knights use the same StandardMaterial
    // instances so Style-panel recolors affect both at once and we don't
    // waste GPU on duplicates.
    const matCache = new Map<string, StandardMaterial>()

    const m1 = await loadKnightInstance(scene, matCache, 'Model 1', MODEL1_POSITION, MODEL1_YROT)
    const m2 = await loadKnightInstance(scene, matCache, 'Model 2', MODEL2_POSITION, MODEL2_YROT)
    // Custom (Model 3): skeleton-only — meshes hidden so user builds from
    // primitives via the Creator tab.
    const m3 = await loadKnightInstance(scene, matCache, 'Custom', MODEL3_POSITION, MODEL3_YROT, true)

    // The first load also brings in animationGroups (baked anims). Both
    // instances share these (they're scene-global) but they only target the
    // first instance's bones. We keep them for the Import-Baked feature.
    // To re-discover them, query scene.animationGroups.
    const animationGroups = scene.animationGroups.slice()

    const allBoneNames = m1.skeleton.bones.map((b) => b.name)

    console.log(
      `[editor] loaded 3 knight instances (Model 1 + Model 2 + Custom skeleton) — ${m1.skeleton.bones.length} bones each`,
    )

    // Load the weapon library — extra GLBs from /public/models/weapons/.
    // Each file lands as a separate hidden node tree; its meshes are
    // surfaced to the Creator's "Weapons (library)" dropdown.
    const weaponLibrary = await loadWeaponLibrary(scene)

    // Make the axe Model 1's primary weapon — hides its stock sword on
    // Hand Hold.R and attaches the textured axe at rotation (90, 90, 45)
    // degrees. Model 2 keeps its sword for combat-sparring contrast.
    attachWeaponToHand(
      scene, weaponLibrary, 'axe_textured',
      m1.glbMeshes, m1.skeleton, 'Hand Hold.R', [90, 90, 45],
    )

    // ─── DEBUG: render store's native knight GLB next to Custom ───
    // Side-by-side visual comparison of the native asset-store export vs
    // our fbx2gltf-converted knight.glb. Place at x=54.5, just past
    // Custom (x=53). Remove this block once the comparison's done.
    try {
      const nativeResult = await SceneLoader.ImportMeshAsync('', '/models/', 'knight_native.glb', scene)
      const nativeRoot =
        nativeResult.meshes.find((m) => m.name === '__root__') ?? nativeResult.meshes[0]
      nativeRoot.name = 'KnightNative'
      nativeRoot.position = new Vector3(54.5, 0, 0)
      // Stop any auto-playing animations — we just want a static A/B.
      nativeResult.animationGroups.forEach((g) => g.stop())
      console.log(`[editor] DEBUG: native knight GLB loaded next to Custom — ${nativeResult.meshes.length} meshes`)
    } catch (err) {
      console.warn('[editor] DEBUG: native knight GLB load failed:', err)
    }

    const api: EditorSceneApi = {
      models: [m1, m2, m3],
      allBoneNames,
      animationGroups,
      weaponLibrary,
      addModel: async (name, position, yRotation, hideAllMeshes = false) => {
        const m = await loadKnightInstance(scene, matCache, name, position, yRotation, hideAllMeshes)
        api.models.push(m)
        return api.models.length - 1
      },
    }
    return api
  } catch (err) {
    console.error('[editor] load failed', err)
    return null
  }
}

// Catalogue of GLBs in /public/models/weapons/. Each entry is loaded
// async at editor scene init. Adding a new weapon = one line here +
// dropping its GLB into /public/models/weapons/.
// `targetMaxDim` (m): the weapon's geometry is auto-scaled at load so
// its largest dimension equals this value. Sensible defaults per kind:
//   axe / sword / mace ≈ 0.6m
//   greatsword ≈ 1.2m
//   dagger ≈ 0.25m
//   bow ≈ 1.0m
//   shield ≈ 0.5m
const WEAPON_CATALOGUE: Array<{
  file: string
  stem: string
  kind: WeaponLibraryEntry['kind']
  targetMaxDim: number
}> = [
  { file: 'axe_textured.glb', stem: 'axe_textured', kind: 'axe', targetMaxDim: 0.6 },
]

export async function loadWeaponLibrary(scene: Scene): Promise<WeaponLibraryEntry[]> {
  const library: WeaponLibraryEntry[] = []
  for (const entry of WEAPON_CATALOGUE) {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '/models/weapons/', entry.file, scene)
      const meshes: Mesh[] = []
      for (const m of result.meshes) {
        if (!(m instanceof Mesh)) continue
        if (m.getTotalVertices() === 0) continue
        // Don't render the source — Creator pulls geometry from it but
        // the original stays invisible offstage.
        m.setEnabled(false)
        meshes.push(m)
      }
      if (meshes.length === 0) {
        console.warn(`[editor] weapon '${entry.stem}' loaded but had no renderable meshes`)
        continue
      }
      // Auto-normalize the weapon's size so cloning produces a sensible
      // result regardless of the FBX/GLB's unit system or parent
      // transform stack. Bakes the world matrix + scale factor into
      // vertex positions; detaches from parent so the mesh stands alone.
      normalizeWeaponMeshes(meshes, entry.targetMaxDim)
      library.push({ stem: entry.stem, meshes, kind: entry.kind })
      console.log(`[editor] weapon library: '${entry.stem}' (${entry.kind}) — ${meshes.length} mesh(es), normalized to ${entry.targetMaxDim}m`)
    } catch (err) {
      console.warn(`[editor] failed to load weapon '${entry.stem}':`, err)
    }
  }
  return library
}

// Bake a uniform scale factor into LOCAL vertex positions so the
// weapon's largest dimension equals `targetMaxDim`. Detaches from
// parent and resets local transform so the mesh stands alone — world
// position equals local vertex position. Clones reading the source
// mesh inherit the normalized geometry directly.
//
// We walk LOCAL vertex coords (NOT world) because parent transforms
// after a GLB load can be lazy or contain conversion matrices that
// don't compose cleanly with our scale factor.
function normalizeWeaponMeshes(meshes: Mesh[], targetMaxDim: number): void {
  // 1. Compute union LOCAL bounding box across all sub-meshes.
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) continue
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
  }
  const dx = maxX - minX
  const dy = maxY - minY
  const dz = maxZ - minZ
  const maxD = Math.max(dx, dy, dz)
  if (!Number.isFinite(maxD) || maxD < 1e-6) return
  const factor = targetMaxDim / maxD
  console.log(`[editor] weapon local bbox: ${dx.toFixed(3)} × ${dy.toFixed(3)} × ${dz.toFixed(3)} (max ${maxD.toFixed(3)}) → factor ${factor.toFixed(3)} → target ${targetMaxDim}m`)
  // 2. For each mesh: multiply vertex positions by factor. Normals
  // are direction vectors — uniform positive scale preserves direction,
  // so we leave them as-is. Reset local transform + detach from parent.
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (positions) {
      const newPositions = new Float32Array(positions.length)
      for (let i = 0; i < positions.length; i++) {
        newPositions[i] = positions[i] * factor
      }
      // setVerticesData (NOT updateVerticesData) — GLB-loaded buffers
      // default to non-updatable, and updateVerticesData silently no-ops
      // on those. setVerticesData replaces the buffer with an updatable
      // one (third arg = true).
      m.setVerticesData(VertexBuffer.PositionKind, newPositions, true)
    }
    m.parent = null
    m.position.setAll(0)
    m.scaling.setAll(1)
    m.rotation.setAll(0)
    m.rotationQuaternion = null
    m.refreshBoundingInfo()
  }
}

// Attach a weapon-library item to a knight's bone, replacing whatever
// non-skinned mesh was previously parented to that bone (typically the
// GLB's stock sword/shield). Used to set the axe as primary weapon on
// hero + Model 1 — the Creator path still handles user-driven adds.
//
// Mirrors the Creator's prop-group-clone math: groupRoot scaling is
// divided by the parent bone's absolute world scale so the weapon
// lands at its normalised size regardless of armature scale.
export function attachWeaponToHand(
  scene: Scene,
  library: WeaponLibraryEntry[],
  stem: string,
  glbMeshes: AbstractMesh[],
  skeleton: Skeleton,
  boneName: string,
  rotationDeg: [number, number, number],
): Mesh | null {
  const entry = library.find((w) => w.stem === stem)
  if (!entry) {
    console.warn(`[weapon] '${stem}' not in library`)
    return null
  }
  const bone = skeleton.bones.find((b) => b.name === boneName)
  const parentNode = bone?._linkedTransformNode
  if (!parentNode) {
    console.warn(`[weapon] bone '${boneName}' missing on skeleton`)
    return null
  }
  // Hide any non-skinned mesh parented (directly or via chain) under
  // this bone — that's the stock sword/shield we're replacing.
  for (const m of glbMeshes) {
    if (!(m instanceof Mesh)) continue
    if (m.skeleton) continue
    if (m.getTotalVertices() === 0) continue
    let cursor: any = m.parent
    while (cursor) {
      if (cursor === parentNode) {
        m.setEnabled(false)
        break
      }
      cursor = cursor.parent
    }
  }
  // Build group root + child meshes from the library.
  const groupRoot = new Mesh(`weapon_${stem}_root`, scene)
  groupRoot.parent = parentNode
  for (const src of entry.meshes) {
    const vdata = VertexData.ExtractFromMesh(src, true)
    const child = new Mesh(`weapon_${stem}_child`, scene)
    vdata.applyToMesh(child)
    child.refreshBoundingInfo()
    child.alwaysSelectAsActiveMesh = true
    child.isPickable = false
    child.renderingGroupId = 0
    child.parent = groupRoot
    if (src.material && typeof (src.material as any).clone === 'function') {
      child.material = (src.material as any).clone(`weapon_mat_${stem}`)
    }
  }
  // Normalised user transform — scale 1.0 = native size of the library
  // entry (already 0.6m after the loader's normalize step).
  parentNode.computeWorldMatrix(true)
  const ws = parentNode.absoluteScaling
  const sx = Math.abs(ws.x) || 1
  const sy = Math.abs(ws.y) || 1
  const sz = Math.abs(ws.z) || 1
  groupRoot.scaling.copyFromFloats(1 / sx, 1 / sy, 1 / sz)
  const DEG = Math.PI / 180
  groupRoot.rotation.copyFromFloats(
    rotationDeg[0] * DEG,
    rotationDeg[1] * DEG,
    rotationDeg[2] * DEG,
  )
  return groupRoot
}

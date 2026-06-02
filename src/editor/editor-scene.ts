import '@babylonjs/loaders/glTF'
import {
  AbstractMesh,
  Color3,
  Material,
  Mesh,
  PBRMaterial,
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
// Model 3 ("Custom") — character-creator target. Loads the v3 GLB with
// every mesh hidden up front; the Creator tab makes them visible per
// slot (default = full kit, matching Model 1/2).
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
// selector. Materials are per-instance so the Style panel edits each
// independently. Custom (Model 3) also carries `customSlots` + tracks any
// library-weapon attachments via `libraryAttachments` for clean disposal.

// Character Creator slots — the Custom knight is a remix of the same v3
// GLB Model 1/2 load, with each piece toggleable via slot selection. Slot
// values that start with `library:` mean a weapon from `WEAPON_CATALOGUE`
// is attached to the corresponding Hand Hold bone instead of the native
// in-skeleton sword/shield mesh.
export type CustomSlots = {
  body: 'none' | 'body'
  helmet: 'none' | 'helmet'
  bodyArmor: 'none' | 'platebody'
  legArmor: 'none' | 'platelegs'
  rightHand: 'none' | 'sword' | `library:${string}`
  leftHand: 'none' | 'shield' | `library:${string}`
}

export const DEFAULT_CUSTOM_SLOTS: CustomSlots = {
  body: 'body',
  helmet: 'helmet',
  bodyArmor: 'platebody',
  legArmor: 'platelegs',
  rightHand: 'sword',
  leftHand: 'shield',
}

// Map slot → mesh-name stem on the v3 GLB. Toggling a slot off hides every
// mesh on Custom whose `name.split('_primitive')[0]` matches the stem.
export const SLOT_NATIVE_STEM: Record<keyof CustomSlots, string | null> = {
  body: 'Body',
  helmet: 'Helmet',
  bodyArmor: 'Platebody',
  legArmor: 'Platelegs',
  rightHand: 'Sword',
  leftHand: 'Shield',
}

// Bone each weapon-library attachment lands on. Right hand → Hand Hold.R,
// left hand → Hand Hold.L. Used by `setCustomSlot` to attach library weapons.
export const SLOT_HAND_BONE: Partial<Record<keyof CustomSlots, string>> = {
  rightHand: 'Hand Hold.R',
  leftHand: 'Hand Hold.L',
}

export type ModelInstance = {
  name: string
  root: AbstractMesh
  skeleton: Skeleton           // primary skeleton for bone lookups
  skeletons: Skeleton[]        // all 8 (need prepare() each frame)
  glbMeshes: AbstractMesh[]
  // Per-instance material cache keyed by GLB material-slot name
  // (Skin / Metal / Blade / etc). Used by the Style tab — each model
  // has independent colours so recolouring Model 2 doesn't affect
  // Model 1 or Custom. Holds either StandardMaterial (legacy flat-shaded
  // assets) or PBRMaterial clones (v3 knight) — the Style APIs dispatch
  // by class.
  matCache: Map<string, Material>
  restPose: Record<string, [number, number, number, number]>
  restPositions: Record<string, [number, number, number]>
  restWorldPositions: Record<string, [number, number, number]>
  position: Vector3            // initial world position (for Reset)
  // Character Creator state — populated only on the Custom model.
  customSlots?: CustomSlots
  // Currently-attached library-weapon group meshes per hand slot. Lets
  // the slot setter dispose the prior attachment before swapping or
  // reverting to the native sword/shield. Custom only.
  libraryAttachments?: Map<'rightHand' | 'leftHand', Mesh>
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
  // Rest pose snapshot of an older knight asset (knight_v1_backup.glb).
  // Used ONCE by the EditorPanel hydration path to retarget saved
  // anchors/poses authored against the old rig to the current v3 rig.
  // After the retarget runs + library.json is re-saved, this can be null
  // and the legacy GLB can be removed.
  legacyRestPose: { rotations: Record<string, [number, number, number, number]>; positions: Record<string, [number, number, number]> } | null
  // Spawn a fresh knight instance at runtime. Used by the "+ Add" button
  // in the left dashboard. Appends to `models` and returns the new index.
  addModel: (name: string, position: Vector3, yRotation: number, hideAllMeshes?: boolean) => Promise<number>
}

async function loadKnightInstance(
  scene: Scene,
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

  // Per-instance material cache — each model owns its own material
  // instance for each GLB slot (Skin / Metal / Blade / …). The Style
  // tab edits these so recolouring is independent per model. Baseline
  // colour is stashed on material.metadata for the Reset path.
  //
  // Two paths by source-material class:
  //   - StandardMaterial (legacy flat-shaded asset): replace with a
  //     hand-picked MAT_COLORS palette entry.
  //   - PBRMaterial (v3 knight): clone the source material per instance
  //     so textures + PBR settings carry over but recolouring one model
  //     doesn't bleed into the others. Style writes to `albedoColor`.
  const matCache = new Map<string, Material>()
  for (const m of result.meshes) {
    m.isPickable = false
    if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
    if (!m.material) continue
    const matName = m.material.name
    let mat = matCache.get(matName)
    if (!mat) {
      if (m.material instanceof StandardMaterial) {
        const baseline = MAT_COLORS[matName] ?? FALLBACK
        const std = new StandardMaterial(`editor_${name}_${matName}`, scene)
        std.diffuseColor = baseline.clone()
        std.specularColor = new Color3(0.10, 0.10, 0.12)
        std.ambientColor = baseline.scale(0.5)
        std.backFaceCulling = false
        std.metadata = { baselineHex: baseline.toHexString() }
        mat = std
      } else if (m.material instanceof PBRMaterial) {
        const src = m.material
        const clone = src.clone(`editor_${name}_${matName}`)
        const baselineHex = src.albedoColor?.toHexString?.() ?? '#888888'
        clone.metadata = { ...(src.metadata ?? {}), baselineHex }
        mat = clone
      } else {
        continue
      }
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
  root.computeWorldMatrix(true)
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    node.rotationQuaternion =
      node.rotationQuaternion ?? node.rotation.toQuaternion()
    const q = node.rotationQuaternion
    restPose[bone.name] = [q.x, q.y, q.z, q.w]
    if (POSITION_BONES.includes(bone.name)) {
      const p = node.position
      restPositions[bone.name] = [p.x, p.y, p.z]
      const wp = node.getAbsolutePosition()
      restWorldPositions[bone.name] = [wp.x, wp.y, wp.z]
    }
  }

  return {
    name,
    root,
    skeleton,
    skeletons,
    glbMeshes: result.meshes,
    matCache,
    restPose,
    restPositions,
    restWorldPositions,
    position: position.clone(),
    // Custom-only slot state; left undefined on Model 1/2.
    customSlots: name === 'Custom' ? { ...DEFAULT_CUSTOM_SLOTS } : undefined,
    libraryAttachments: name === 'Custom' ? new Map() : undefined,
  }
}

export async function createEditorScene(scene: Scene): Promise<EditorSceneApi | null> {
  try {
    // Each model gets its OWN material cache (per-instance), so the Style
    // tab edits one knight at a time. Recolouring Model 2 doesn't affect
    // Model 1, Custom, or any other model spawned later.
    const m1 = await loadKnightInstance(scene, 'Model 1', MODEL1_POSITION, MODEL1_YROT)
    const m2 = await loadKnightInstance(scene, 'Model 2', MODEL2_POSITION, MODEL2_YROT)
    // Custom (Model 3): loads the same v3 GLB as Model 1/2 with every mesh
    // hidden up front. The Creator tab toggles slot meshes back on per the
    // user's slot selections (default = full kit, matching Model 1/2).
    const m3 = await loadKnightInstance(scene, 'Custom', MODEL3_POSITION, MODEL3_YROT, true)

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

    // Model 1 keeps its stock sword from the v3 knight GLB. Weapon
    // library still loaded so the Creator's Weapons (library) category
    // works on Custom. Re-enable attachWeaponToHand here if you want
    // Model 1 to default to the axe again.
    void weaponLibrary  // keep ref for the Creator path

    // One-time legacy rest pose capture — loaded ONLY to provide retarget
    // data for anchors/poses authored against the older knight asset.
    // Silently null if backup file is missing (post-retarget cleanup).
    const legacyRestPose = await loadLegacyRestPose(scene, 'knight_v1_backup.glb')

    const api: EditorSceneApi = {
      models: [m1, m2, m3],
      allBoneNames,
      animationGroups,
      weaponLibrary,
      legacyRestPose,
      addModel: async (name, position, yRotation, hideAllMeshes = false) => {
        const m = await loadKnightInstance(scene, name, position, yRotation, hideAllMeshes)
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
  // Optional: stretch only the handle (lower portion of mesh) by N
  // metres along the long axis after normalise. The head stays at its
  // native size; the handle gets longer. Linear falloff anchored at the
  // top of the handle so the head/handle junction stays geometrically
  // continuous.
  handleExtensionM?: number
  // Fraction of the total mesh height (from the bottom) that counts as
  // "handle" for the extension. Default 0.6 = bottom 60% is handle.
  handleFractionFromBottom?: number
  // When true, shifts all vertices up so the lowest point (handle tip)
  // sits at mesh-local Y=0. The hand bone's origin is therefore at the
  // END of the pole — knight grips the handle tip, not the middle. Lets
  // the handle's length grow/shrink without shifting where the model
  // holds it.
  gripAtBottom?: boolean
}> = [
  // 0.12m extension → total ≈ 0.77m (10% shorter than the 0.86m the
  // 0.2 extension yielded). Grip anchored at handle tip.
  { file: 'axe_textured.glb', stem: 'axe_textured', kind: 'axe', targetMaxDim: 0.6, handleExtensionM: 0.12, handleFractionFromBottom: 0.6, gripAtBottom: true },
  // Meshy v5 generation — high-poly PBR-textured double-edge axe.
  // 1.6m total ≈ polearm scale, fits the long-haft silhouette.
  { file: 'double_edge_axe.glb', stem: 'double_edge_axe', kind: 'axe', targetMaxDim: 1.6 },
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
      // Optional handle stretch — keeps head at native size, lengthens
      // the handle. Runs AFTER normalise so the extension is in world
      // metres, not GLB units.
      if (entry.handleExtensionM && entry.handleExtensionM > 0) {
        extendWeaponHandle(meshes, entry.handleExtensionM, entry.handleFractionFromBottom ?? 0.6)
      }
      // Optional grip-at-bottom shift — moves the mesh origin to the
      // handle tip so the hand bone grips the END of the pole (not the
      // middle). Runs LAST so any length changes from extendWeaponHandle
      // are reflected before measuring.
      if (entry.gripAtBottom) {
        shiftMeshOriginToBottom(meshes)
      }
      library.push({ stem: entry.stem, meshes, kind: entry.kind })
      console.log(`[editor] weapon library: '${entry.stem}' (${entry.kind}) — ${meshes.length} mesh(es), normalized to ${entry.targetMaxDim}m${entry.handleExtensionM ? ` + ${entry.handleExtensionM}m handle stretch` : ''}${entry.gripAtBottom ? ' + grip-at-bottom' : ''}`)
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

// Stretch the handle of an upright weapon (head at +Y, handle below)
// without resizing the head. Assumes the long axis is Y in mesh-local
// space (true for this axe pack after normalise). Vertices with
// Y > handleTopY stay put; vertices below are pushed downward via a
// linear falloff so the handle top stays continuous with the head.
//
// `handleFractionFromBottom` (0..1) — fraction of total height that
// counts as handle. 0.6 = bottom 60% is handle, top 40% is head.
function extendWeaponHandle(
  meshes: Mesh[],
  extensionM: number,
  handleFractionFromBottom: number,
): void {
  // 1. Union Y bbox.
  let minY = Infinity, maxY = -Infinity
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) continue
    for (let i = 1; i < positions.length; i += 3) {
      if (positions[i] < minY) minY = positions[i]
      if (positions[i] > maxY) maxY = positions[i]
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return
  const totalHeight = maxY - minY
  if (totalHeight <= 0) return
  const handleTopY = minY + totalHeight * handleFractionFromBottom
  const handleLen = handleTopY - minY
  if (handleLen <= 0) return
  // 2. Stretch handle vertices: linear falloff so handleTop stays put,
  // bottom-most vertex moves down by extensionM. Mesh boundary (head/
  // handle ring) is unchanged so the silhouette stays watertight.
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) continue
    const newPositions = new Float32Array(positions)
    for (let i = 1; i < positions.length; i += 3) {
      const y = positions[i]
      if (y >= handleTopY) continue
      const fraction = (handleTopY - y) / handleLen
      newPositions[i] = y - fraction * extensionM
    }
    m.setVerticesData(VertexBuffer.PositionKind, newPositions, true)
    m.refreshBoundingInfo()
  }
}

// Load a knight GLB just to extract its rest pose (per-bone local
// rotation + position), then dispose the loaded scene graph. Used to
// retarget anchors/poses from an older asset to the current rig — the
// stored values are author-intent expressed in the old rig's rest
// frame, so we need both rest poses to compute the bone deltas.
//
// Returns `null` if the file can't be loaded (e.g. post-retarget the
// backup file has been deleted).
export async function loadLegacyRestPose(
  scene: Scene,
  filename: string,
): Promise<EditorSceneApi['legacyRestPose']> {
  try {
    const r = await SceneLoader.ImportMeshAsync('', '/models/', filename, scene)
    const skeleton = r.skeletons[0]
    if (!skeleton) {
      r.meshes.forEach((m) => m.dispose())
      console.warn(`[editor] legacy '${filename}' loaded but no skeleton found`)
      return null
    }
    const rotations: Record<string, [number, number, number, number]> = {}
    const positions: Record<string, [number, number, number]> = {}
    // Force world matrix so linked TransformNodes have fresh local
    // transforms before we read.
    const root = r.meshes.find((m) => m.name === '__root__') ?? r.meshes[0]
    root.computeWorldMatrix(true)
    for (const bone of skeleton.bones) {
      const node = bone._linkedTransformNode
      if (!node) continue
      node.rotationQuaternion = node.rotationQuaternion ?? node.rotation.toQuaternion()
      const q = node.rotationQuaternion
      rotations[bone.name] = [q.x, q.y, q.z, q.w]
      if (POSITION_BONES.includes(bone.name)) {
        const p = node.position
        positions[bone.name] = [p.x, p.y, p.z]
      }
    }
    // Tear down the scene graph — we only needed the rest data.
    r.skeletons.forEach((s) => s.dispose())
    r.meshes.forEach((m) => m.dispose())
    r.animationGroups.forEach((g) => g.dispose())
    console.log(`[editor] legacy rest pose '${filename}' captured (${Object.keys(rotations).length} bones)`)
    return { rotations, positions }
  } catch (err) {
    console.log(`[editor] legacy '${filename}' not present — skipping retarget (this is fine after a one-time retarget)`)
    return null
  }
}

// Translate all vertices upward by -minY so the lowest point of the
// mesh lands at Y=0 in mesh-local space. Used for weapons with
// `gripAtBottom: true` — the bone-attached mesh's local origin then
// coincides with the handle's tip, so the knight grips the END of the
// pole, not the middle. Re-running `extendWeaponHandle` first ensures
// "bottom" reflects the post-stretch handle length.
function shiftMeshOriginToBottom(meshes: Mesh[]): void {
  let minY = Infinity
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) continue
    for (let i = 1; i < positions.length; i += 3) {
      if (positions[i] < minY) minY = positions[i]
    }
  }
  if (!Number.isFinite(minY) || Math.abs(minY) < 1e-5) return
  for (const m of meshes) {
    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    if (!positions) continue
    const newPositions = new Float32Array(positions)
    for (let i = 1; i < positions.length; i += 3) {
      newPositions[i] -= minY
    }
    m.setVerticesData(VertexBuffer.PositionKind, newPositions, true)
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
  // Force the new group + its children's world matrices to recompute
  // immediately so the weapon shows on the same frame it's attached.
  // Without this, the mesh exists in the scene but doesn't render until
  // a later frame triggers `computeWorldMatrix` from the parent chain.
  groupRoot.computeWorldMatrix(true)
  for (const child of groupRoot.getChildMeshes(true)) {
    child.computeWorldMatrix(true)
  }
  return groupRoot
}

// Flip BOTH `isVisible` and `setEnabled` on every Mesh on `model` whose
// name stem matches `stem` (Babylon's GLB loader names multi-primitive
// meshes "<stem>_primitive<N>"). Used by the Custom slot toggles —
// making a slot off hides all primitives of that piece, making it on
// shows them all. Dual-flagging is required because `attachWeaponToHand`
// uses `setEnabled(false)` to disable the native sword/shield when a
// library weapon is attached — going back to the native must re-enable
// it, not just unhide it.
export function setCustomMeshVisibleByStem(
  model: ModelInstance,
  stem: string,
  visible: boolean,
): void {
  for (const m of model.glbMeshes) {
    if (!(m instanceof Mesh)) continue
    if (m.getTotalVertices() === 0) continue
    const meshStem = m.name.split('_primitive')[0]
    if (meshStem === stem) {
      m.isVisible = visible
      m.setEnabled(visible)
    }
  }
}

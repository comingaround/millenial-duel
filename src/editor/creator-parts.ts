import {
  AbstractMesh,
  Bone,
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  VertexData,
} from '@babylonjs/core'
import type {
  CreatorPart,
  CreatorPartInstance,
  CreatorShape,
  ModelInstance,
} from './editor-scene'

// Default dimensions per shape.
// Primitives: stored as WORLD-METRES (UI shows in cm = ×100). The mesh's
// local scaling/position is normalised by the parent bone's absolute
// world scale at apply-time, so what the user types is what they see.
// 'clone': stored scale is a direct multiplier (1.0 = native source size,
// 1.5 = 150% etc). UI still shows ×100 — so 100 reads as "100% size".
export const DEFAULT_PART_DEFAULTS: Record<CreatorShape, {
  scale: [number, number, number]
  offset: [number, number, number]
}> = {
  sphere:   { scale: [0.08, 0.08, 0.08], offset: [0, 0, 0] },     // joint dot
  box:      { scale: [0.20, 0.30, 0.15], offset: [0, 0, 0] },     // torso slab
  cylinder: { scale: [0.08, 0.30, 0.08], offset: [0, 0.15, 0] },  // limb segment
  capsule:  { scale: [0.08, 0.30, 0.08], offset: [0, 0.15, 0] },  // rounded limb
  clone:    { scale: [1.00, 1.00, 1.00], offset: [0, 0, 0] },     // 100% of source
}

const DEFAULT_COLOR_PRIMITIVE = '#8a8d92'  // neutral grey
// Sentinel — clones leave color empty so create funcs can fill it from
// the source material's actual diffuse/albedo. If sampling fails, falls
// back to DEFAULT_COLOR_PRIMITIVE.
const COLOR_FROM_SOURCE        = ''
const DEG2RAD = Math.PI / 180

export function newPartId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `part_${Date.now()}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function defaultPartFor(boneName: string, shape: CreatorShape): CreatorPart {
  const d = DEFAULT_PART_DEFAULTS[shape]
  return {
    id: newPartId(),
    boneName,
    shape,
    scale: [...d.scale] as [number, number, number],
    offset: [...d.offset] as [number, number, number],
    rotation: [0, 0, 0],
    // Primitives still pick a neutral grey; clones defer to source.
    color: shape === 'clone' ? COLOR_FROM_SOURCE : DEFAULT_COLOR_PRIMITIVE,
  }
}

// Sample a colour off a Babylon material. Supports StandardMaterial
// (diffuseColor) + PBRMaterial (albedoColor). Returns lowercase hex
// "#rrggbb" or null when the material can't be sampled.
function sampleMaterialHex(src: any): string | null {
  if (!src) return null
  const c: Color3 | undefined = src.diffuseColor ?? src.albedoColor
  if (!c || typeof c.toHexString !== 'function') return null
  return c.toHexString().toLowerCase()
}

// Build a part's mesh + own material on the customModel. For 'clone'
// shape, sourceModel is required (the Model 1 instance to extract from).
//
// IMPORTANT: each part owns its OWN StandardMaterial — NOT shared with
// the knight matCache — so recolouring a part doesn't tint the whole rig.
export function createPartMesh(
  scene: Scene,
  part: CreatorPart,
  customModel: ModelInstance,
  sourceModel?: ModelInstance,
): CreatorPartInstance {
  if (part.shape === 'clone') {
    if (!sourceModel) {
      console.warn(`[creator] clone part ${part.id} created without sourceModel; using sphere placeholder`)
      return createPrimitivePart(scene, { ...part, shape: 'sphere' }, customModel)
    }
    // Group of non-skinned props (e.g. multi-primitive sword) — children
    // share one TransformNode under the bone, so one transform/color
    // affects all sub-meshes.
    if (part.groupMeshNames && part.groupMeshNames.length > 0) {
      return createPropGroupClonePart(scene, part, customModel, sourceModel)
    }
    // Prop clone (single non-skinned mesh) — sourceMeshName identifies
    // which mesh in source to duplicate, with boneName as the attachment
    // point on Custom.
    if (part.sourceMeshName) return createPropClonePart(scene, part, customModel, sourceModel)
    // Skinned bone clone — extract triangles owned by part.boneName.
    return createClonePart(scene, part, customModel, sourceModel)
  }
  // Legacy primitives (sphere/box/cylinder/capsule) — keep rendering path
  // so older library.json entries still work, but the UI no longer offers
  // them as new options.
  return createPrimitivePart(scene, part, customModel)
}

function createPrimitivePart(
  scene: Scene,
  part: CreatorPart,
  customModel: ModelInstance,
): CreatorPartInstance {
  const parentNode = findLinkedNode(customModel, part.boneName)
  if (!parentNode) throw new Error(`Bone '${part.boneName}' not found on ${customModel.name}`)

  const meshName = `creator_${part.shape}_${part.id}`
  let mesh: Mesh
  switch (part.shape) {
    case 'sphere':
      mesh = MeshBuilder.CreateSphere(meshName, { diameter: 1, segments: 16 }, scene)
      break
    case 'box':
      mesh = MeshBuilder.CreateBox(meshName, { size: 1 }, scene)
      break
    case 'cylinder':
      mesh = MeshBuilder.CreateCylinder(meshName, { diameter: 1, height: 1, tessellation: 24 }, scene)
      break
    case 'capsule':
      mesh = MeshBuilder.CreateCapsule(meshName, { radius: 0.5, height: 1, tessellation: 24, subdivisions: 4 }, scene)
      break
    default:
      throw new Error(`createPrimitivePart called with shape '${part.shape}'`)
  }
  mesh.parent = parentNode
  applyPrimitiveTransform(mesh, parentNode, part.scale, part.offset, part.rotation)
  mesh.isPickable = false
  mesh.renderingGroupId = 0
  mesh.metadata = { creatorPartId: part.id }
  return wrapWithMaterial(scene, mesh, part)
}

function createClonePart(
  scene: Scene,
  part: CreatorPart,
  customModel: ModelInstance,
  sourceModel: ModelInstance,
): CreatorPartInstance {
  // Find a target bone + reference mesh in Custom. Babylon's attachToBone
  // needs a Bone instance and a "referal" mesh that belongs to a skin
  // using that skeleton — the reference mesh's world matrix anchors the
  // bone-attached mesh into scene world space.
  const targetSkin = findSkin(customModel, part.boneName)
  if (!targetSkin) {
    console.warn(`[creator] no skin on Custom contains bone '${part.boneName}'; using sphere placeholder`)
    return placeholderClone(scene, part, customModel)
  }

  const geom = extractBoneGeometry(sourceModel, part.boneName, part.meshFilter)
  if (!geom) {
    console.warn(`[creator] no skinned geometry found for bone '${part.boneName}' on ${sourceModel.name}; using sphere placeholder`)
    return placeholderClone(scene, part, customModel)
  }

  const mesh = new Mesh(`creator_clone_${part.id}`, scene)
  const vdata = new VertexData()
  vdata.positions = geom.positions
  vdata.indices = geom.indices
  vdata.normals = geom.normals
  vdata.applyToMesh(mesh)
  // Bone-attached meshes get their world matrix recomputed every frame
  // by Babylon's bone-link path. Frustum bounding can lag — disable
  // culling so the mesh always renders.
  mesh.refreshBoundingInfo()
  mesh.alwaysSelectAsActiveMesh = true
  mesh.isPickable = false
  mesh.renderingGroupId = 0
  mesh.metadata = { creatorPartId: part.id }

  // Canonical Babylon API: parents via the bone hierarchy + reference
  // mesh, so the bone-local geometry lands in the correct on-screen
  // location (the same place the source mesh's vertices rendered, but
  // on Custom's bone). This avoids the Blender→glTF scene-graph
  // transforms that polluted naive parent-to-TransformNode parenting.
  mesh.attachToBone(targetSkin.bone, targetSkin.refMesh)
  applyCloneTransform(mesh, part.scale, part.offset, part.rotation)

  // Seed colour from the first source mesh that contributed triangles
  // to this bone — preserves the skin/clothes/armour palette instead
  // of slapping a default red on every body-part clone.
  if (geom.firstSourceMaterial) {
    const sampled = sampleMaterialHex(geom.firstSourceMaterial)
    if (sampled) part.color = sampled
  }
  if (!part.color) part.color = DEFAULT_COLOR_PRIMITIVE
  return wrapWithMaterial(scene, mesh, part)
}

// Clone a NON-skinned source mesh (sword, shield, etc) by name. Copies
// the vertex data + material colour, parents the new mesh to the same
// bone on Custom via the linkedTransformNode (which is the correct API
// for static meshes — unlike skinned clones, which need attachToBone).
// Source local transform (position/rotation/scaling relative to its bone
// parent) is copied so the clone sits where the source did.
function createPropClonePart(
  scene: Scene,
  part: CreatorPart,
  customModel: ModelInstance,
  sourceModel: ModelInstance,
): CreatorPartInstance {
  const sourceMesh = sourceModel.glbMeshes.find(
    (m) => m instanceof Mesh && m.name === part.sourceMeshName && m.getTotalVertices() > 0,
  ) as Mesh | undefined
  if (!sourceMesh) {
    console.warn(`[creator] prop '${part.sourceMeshName}' not found on ${sourceModel.name}; using sphere placeholder`)
    return placeholderClone(scene, part, customModel)
  }
  const parentNode = findLinkedNode(customModel, part.boneName)
  if (!parentNode) {
    console.warn(`[creator] bone '${part.boneName}' missing on Custom; using sphere placeholder`)
    return placeholderClone(scene, part, customModel)
  }

  // Pull geometry. VertexData.ExtractFromMesh gives positions, normals,
  // indices (and uvs/colors if present) without copying the source.
  const sourceVData = VertexData.ExtractFromMesh(sourceMesh, /* copy */ true)
  const mesh = new Mesh(`creator_prop_${part.id}`, scene)
  sourceVData.applyToMesh(mesh)
  mesh.refreshBoundingInfo()
  mesh.alwaysSelectAsActiveMesh = true
  mesh.isPickable = false
  mesh.renderingGroupId = 0
  mesh.metadata = { creatorPartId: part.id }
  mesh.parent = parentNode

  // In-skeleton props (parented to a Model 1 bone) carry a meaningful
  // local pose — copy it. Library weapons (parent=null) start at
  // identity so the bone + user offset/rot determines pose entirely.
  const inSkeletonProp = sourceMesh.parent !== null
  if (inSkeletonProp) {
    mesh.position.copyFrom(sourceMesh.position)
    if (sourceMesh.rotationQuaternion) {
      mesh.rotationQuaternion = sourceMesh.rotationQuaternion.clone()
    } else {
      mesh.rotation.copyFrom(sourceMesh.rotation)
    }
    mesh.scaling.copyFrom(sourceMesh.scaling)
  }
  // Apply user adjustments ON TOP via offset/rotation Euler (deg) /
  // scale multiplier. For props, this lets users nudge the cloned sword
  // forward or rescale without losing the canonical "in hand" placement.
  mesh.position.addInPlaceFromFloats(part.offset[0], part.offset[1], part.offset[2])
  mesh.scaling.multiplyInPlace(new Vector3(part.scale[0], part.scale[1], part.scale[2]))
  if (part.rotation[0] || part.rotation[1] || part.rotation[2]) {
    const userRot = Vector3.FromArray([part.rotation[0], part.rotation[1], part.rotation[2]]).scale(DEG2RAD)
    if (mesh.rotationQuaternion) {
      // Add user delta as an Euler post-rotation
      mesh.rotation.copyFrom(userRot)
      mesh.rotationQuaternion = null  // fall back to Euler — Babylon uses whichever is set
    } else {
      mesh.rotation.copyFromFloats(userRot.x, userRot.y, userRot.z)
    }
  }

  console.log(`[creator] prop clone '${part.sourceMeshName}' → bone '${part.boneName}': ${sourceVData.positions ? (sourceVData.positions.length / 3) : 0} verts`)
  // Seed the colour from the source mesh's material so the clone starts
  // life looking like the original. Recolouring later (via style panel)
  // is unrelated.
  const sampled = sampleMaterialHex(sourceMesh.material)
  if (sampled) part.color = sampled
  else if (!part.color) part.color = DEFAULT_COLOR_PRIMITIVE
  return wrapWithMaterial(scene, mesh, part)
}

// Group prop clone: ONE TransformNode under the target bone + N child
// meshes (one per source mesh name in groupMeshNames) nested under it.
// The group root is what carries the user's scale/offset/rotation, so
// editing transforms moves all children together. Color edits write to
// EVERY child's material so the group has a single shared colour.
function createPropGroupClonePart(
  scene: Scene,
  part: CreatorPart,
  customModel: ModelInstance,
  sourceModel: ModelInstance,
): CreatorPartInstance {
  const parentNode = findLinkedNode(customModel, part.boneName)
  if (!parentNode) {
    console.warn(`[creator] bone '${part.boneName}' missing on Custom; group placeholder`)
    return placeholderClone(scene, part, customModel)
  }
  // The group "mesh" — a 0-vertex Mesh used purely as a TransformNode.
  // Easier than a TransformNode because Babylon's parent-typing works
  // the same and disposal cleans up cleanly.
  const groupRoot = new Mesh(`creator_group_${part.id}`, scene)
  groupRoot.parent = parentNode
  groupRoot.metadata = { creatorPartId: part.id }

  const children: Array<{ mesh: Mesh; material: StandardMaterial }> = []
  for (const childName of part.groupMeshNames!) {
    const src = sourceModel.glbMeshes.find(
      (m) => m instanceof Mesh && m.name === childName && m.getTotalVertices() > 0,
    ) as Mesh | undefined
    if (!src) {
      console.warn(`[creator] group child '${childName}' not found; skipped`)
      continue
    }
    const vdata = VertexData.ExtractFromMesh(src, true)
    const child = new Mesh(`creator_group_${part.id}_${childName}`, scene)
    vdata.applyToMesh(child)
    child.refreshBoundingInfo()
    child.alwaysSelectAsActiveMesh = true
    child.isPickable = false
    child.renderingGroupId = 0
    child.parent = groupRoot
    // In-skeleton props (sword/shield parented to Model 1's hand bone)
    // have a meaningful source-local pose relative to that bone — copy
    // it. Library weapons (loaded standalone, parent=null after the
    // normalize step) have no such anchor — start at identity so the
    // user's bone choice + per-part offset/rot fully determines pose.
    const inSkeletonProp = src.parent !== null
    if (inSkeletonProp) {
      child.position.copyFrom(src.position)
      if (src.rotationQuaternion) child.rotationQuaternion = src.rotationQuaternion.clone()
      else child.rotation.copyFrom(src.rotation)
      child.scaling.copyFrom(src.scaling)
    }
    // else: leave child at identity local — vertices are already self-
    // contained at normalized scale.

    // Clone the source material so textures (albedoTexture, normalMap,
    // specular/roughness, etc) AND base colour carry through. Cloning
    // gives the part its own independent material — disposing the clone
    // won't affect the source. If source has no material, fall back to
    // a sampled-colour StandardMaterial.
    let mat: any
    if (src.material && typeof (src.material as any).clone === 'function') {
      mat = (src.material as any).clone(`creator_mat_${part.id}_${childName}`)
    } else {
      mat = new StandardMaterial(`creator_mat_${part.id}_${childName}`, scene)
      const sampled = sampleMaterialHex(src.material)
      if (sampled) applyColor(mat, sampled)
      else if (part.color) applyColor(mat, part.color)
      else applyColor(mat, DEFAULT_COLOR_PRIMITIVE)
      mat.specularColor = new Color3(0.10, 0.10, 0.12)
      mat.backFaceCulling = false
    }
    child.material = mat
    children.push({ mesh: child, material: mat })
  }
  if (children.length === 0) {
    groupRoot.dispose()
    console.warn(`[creator] group '${part.id}' had no resolvable children; using placeholder`)
    return placeholderClone(scene, part, customModel)
  }
  // Schema colour — first child's sampled value (for save/load + future
  // style panel). Children's actual materials are independent.
  if (!part.color) {
    const firstSrc = sourceModel.glbMeshes.find(
      (m) => m instanceof Mesh && m.name === part.groupMeshNames![0],
    ) as Mesh | undefined
    const firstSampled = firstSrc ? sampleMaterialHex(firstSrc.material) : null
    part.color = firstSampled ?? DEFAULT_COLOR_PRIMITIVE
  }

  // Apply user's group-level transform on top — NORMALISED by the
  // parent bone's absolute world scale. Knight bones carry baked
  // armature scale (often 100×) inherited from the GLB; without this
  // division, a "100% size" weapon would render 100× too big.
  applyGroupTransform(groupRoot, parentNode, part.scale, part.offset, part.rotation)

  console.log(`[creator] group clone (${children.length} children) → bone '${part.boneName}'`)
  return {
    data: { ...part },
    mesh: groupRoot,
    material: children[0].material,
    groupChildren: children,
  }
}

function placeholderClone(scene: Scene, part: CreatorPart, customModel: ModelInstance): CreatorPartInstance {
  // Render a small grey sphere on the target bone but keep shape='clone'
  // in the persisted data — user can re-point the bone and re-extract.
  const fallbackPart = { ...part, shape: 'sphere' as CreatorShape, scale: [0.10, 0.10, 0.10] as [number, number, number] }
  const inst = createPrimitivePart(scene, fallbackPart, customModel)
  inst.data = { ...part }
  return inst
}

function wrapWithMaterial(scene: Scene, mesh: Mesh, part: CreatorPart): CreatorPartInstance {
  const material = new StandardMaterial(`creator_mat_${part.id}`, scene)
  applyColor(material, part.color)
  material.specularColor = new Color3(0.10, 0.10, 0.12)
  material.backFaceCulling = false
  mesh.material = material
  return { data: { ...part }, mesh, material }
}

// Apply patch in-place. Re-creates mesh if shape changes (different
// primitive); otherwise mutates transform/material only.
export function updatePartMesh(
  scene: Scene,
  inst: CreatorPartInstance,
  patch: Partial<CreatorPart>,
  customModel: ModelInstance,
  sourceModel?: ModelInstance,
): CreatorPartInstance {
  const next: CreatorPart = { ...inst.data, ...patch }
  // Shape change → rebuild
  if (patch.shape && patch.shape !== inst.data.shape) {
    disposePartMesh(inst)
    return createPartMesh(scene, next, customModel, sourceModel)
  }
  // Bone change on a clone re-extracts geometry. Bone change on a
  // primitive needs a reparent (different TransformNode).
  if (patch.boneName && patch.boneName !== inst.data.boneName) {
    if (next.shape === 'clone') {
      disposePartMesh(inst)
      return createPartMesh(scene, next, customModel, sourceModel)
    }
    const newParent = findLinkedNode(customModel, patch.boneName)
    if (newParent) inst.mesh.parent = newParent
  }
  // For single prop clones, ANY transform change rebuilds the mesh so
  // we re-apply the source mesh's local pose + user adjustments cleanly.
  // Group clones edit the group root directly (cheaper than rebuild).
  if (next.sourceMeshName && !next.groupMeshNames && (patch.scale || patch.offset || patch.rotation)) {
    disposePartMesh(inst)
    return createPartMesh(scene, next, customModel, sourceModel)
  }
  const needsTransform = !!patch.scale || !!patch.offset || !!patch.rotation || !!patch.boneName
  if (needsTransform) {
    if (next.groupMeshNames) {
      // Group root carries the user transform — children stay at their
      // copied source-local poses, so the group rotates/scales as one.
      // Normalised by parent bone's baked armature scale (knight bones
      // carry ~100× scale that would otherwise multiply the weapon).
      const parent = inst.mesh.parent as TransformNode | null
      if (parent) {
        applyGroupTransform(inst.mesh, parent, next.scale, next.offset, next.rotation)
      }
    } else if (next.shape === 'clone') {
      applyCloneTransform(inst.mesh, next.scale, next.offset, next.rotation)
    } else {
      const parent = inst.mesh.parent as TransformNode | null
      if (parent) applyPrimitiveTransform(inst.mesh, parent, next.scale, next.offset, next.rotation)
    }
  }
  if (patch.color) {
    if (inst.groupChildren) {
      for (const c of inst.groupChildren) applyColor(c.material, patch.color)
    } else {
      applyColor(inst.material, patch.color)
    }
  }
  inst.data = next
  return inst
}

// Primitive transforms: user-meters → bone-local units by dividing
// through the parent bone's absolute world scale. Without this, baked
// armature scaling makes "15cm" render as metres.
function applyPrimitiveTransform(
  mesh: Mesh,
  parent: TransformNode,
  scale: [number, number, number],
  offset: [number, number, number],
  rotation: [number, number, number],
): void {
  parent.computeWorldMatrix(true)
  const ws = parent.absoluteScaling
  const sx = Math.abs(ws.x) || 1
  const sy = Math.abs(ws.y) || 1
  const sz = Math.abs(ws.z) || 1
  mesh.scaling.copyFromFloats(scale[0] / sx, scale[1] / sy, scale[2] / sz)
  mesh.position.copyFromFloats(offset[0] / sx, offset[1] / sy, offset[2] / sz)
  mesh.rotation.copyFromFloats(rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD)
}

// Clone transforms: scale is a direct multiplier (geometry is already
// in correct bone-local space). Offset/rotation are in bone-local
// coordinates — the user types small numbers since the bone frame is
// already at "natural" scale via the inverse-bind extraction.
function applyCloneTransform(
  mesh: Mesh,
  scale: [number, number, number],
  offset: [number, number, number],
  rotation: [number, number, number],
): void {
  mesh.scaling.copyFromFloats(scale[0], scale[1], scale[2])
  mesh.position.copyFromFloats(offset[0], offset[1], offset[2])
  mesh.rotation.copyFromFloats(rotation[0] * DEG2RAD, rotation[1] * DEG2RAD, rotation[2] * DEG2RAD)
}

// Apply user scale/offset/rotation to a group root parented to a bone
// TransformNode. Divides by `parent.absoluteScaling` so the user's
// scale (1.0 = 100%) lands at the weapon's normalised world size,
// not multiplied by the bone's baked armature scale (often 100×).
// Offset is also normalised — cm in = cm rendered.
function applyGroupTransform(
  groupRoot: Mesh,
  parent: TransformNode,
  scale: [number, number, number],
  offset: [number, number, number],
  rotation: [number, number, number],
): void {
  parent.computeWorldMatrix(true)
  const ws = parent.absoluteScaling
  const sx = Math.abs(ws.x) || 1
  const sy = Math.abs(ws.y) || 1
  const sz = Math.abs(ws.z) || 1
  groupRoot.scaling.copyFromFloats(scale[0] / sx, scale[1] / sy, scale[2] / sz)
  groupRoot.position.copyFromFloats(offset[0] / sx, offset[1] / sy, offset[2] / sz)
  groupRoot.rotation.copyFromFloats(
    rotation[0] * DEG2RAD,
    rotation[1] * DEG2RAD,
    rotation[2] * DEG2RAD,
  )
}

// Walk every skinned mesh on the source. For each triangle with at
// least one vertex meaningfully weighted (≥0.30) to the target bone,
// copy those vertices transformed into bone-local-skeleton space by
// bone.getAbsoluteInverseBindMatrix() (canonical Babylon skinning math).
// Returns null if no triangles qualify.
//
// Triangle ownership: each triangle is assigned to the bone with the
// HIGHEST cumulative weight across its 3 vertices ("centroid bone"). A
// triangle is included in this clone ONLY when this clone's bone wins.
// Clean partition — every triangle is owned by exactly one bone, no
// overlap between adjacent clones (no Z-fighting at hip↔leg seams).
//
// Normals: copied from the source mesh's vertex normals (transformed by
// invBind as directions) so adjacent clones share identical normals at
// the seam — no shading crease at joints. Falls back to ComputeNormals
// only if the source GLB doesn't ship vertex normals.
function extractBoneGeometry(
  source: ModelInstance,
  boneName: string,
  meshFilter?: string[],
): { positions: Float32Array; indices: number[]; normals: number[]; firstSourceMaterial: any } | null {
  const outPositions: number[] = []
  const outIndices: number[] = []
  const outNormals: number[] = []
  let nextIdx = 0
  let totalTris = 0
  let normalsAvailable = true
  // First source mesh that contributes at least one triangle — its
  // material colour seeds the clone's initial appearance.
  let firstSourceMaterial: any = null

  for (const m of source.glbMeshes) {
    if (!(m instanceof Mesh)) continue
    if (m.getTotalVertices() === 0) continue
    if (!m.skeleton) continue
    // Mesh-stem filter (body vs armor): skip meshes not in the allowlist.
    // Stem strips Babylon's "_primitive<N>" suffix added for multi-material
    // primitives — so "Helmet_primitive0" still matches "Helmet" in the list.
    if (meshFilter) {
      const stem = m.name.split('_primitive')[0]
      if (!meshFilter.includes(stem)) continue
    }
    const boneIdx = m.skeleton.bones.findIndex((b) => b.name === boneName)
    if (boneIdx < 0) continue
    const bone = m.skeleton.bones[boneIdx]
    // Per-mesh inverse bind matrix — each skin in a multi-skin GLB may
    // have its own inverseBindMatrices that subtly differ.
    const invBind = bone.getAbsoluteInverseBindMatrix()

    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    const normalsSrc = m.getVerticesData(VertexBuffer.NormalKind)
    const mIdx = m.getVerticesData(VertexBuffer.MatricesIndicesKind)
    const mWts = m.getVerticesData(VertexBuffer.MatricesWeightsKind)
    const indices = m.getIndices()
    if (!positions || !mIdx || !mWts || !indices) continue
    if (!normalsSrc) normalsAvailable = false

    const localMap = new Map<number, number>()
    const triCount = (indices.length / 3) | 0
    const v = new Vector3()
    const n = new Vector3()
    // Reused tally for triangle's bone-weight sum. Map keyed by bone index.
    const tally = new Map<number, number>()
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3]
      const i1 = indices[t * 3 + 1]
      const i2 = indices[t * 3 + 2]
      // Sum bone weights across the triangle's 3 vertices.
      tally.clear()
      for (const vi of [i0, i1, i2] as const) {
        for (let k = 0; k < 4; k++) {
          const bi = mIdx[vi * 4 + k]
          const w = mWts[vi * 4 + k]
          if (w <= 0) continue
          tally.set(bi, (tally.get(bi) ?? 0) + w)
        }
      }
      // Pick the bone with the largest cumulative weight.
      let bestBone = -1
      let bestSum = -1
      for (const [bi, s] of tally) {
        if (s > bestSum) {
          bestSum = s
          bestBone = bi
        }
      }
      if (bestBone !== boneIdx) continue
      totalTris++
      if (!firstSourceMaterial && m.material) firstSourceMaterial = m.material
      for (const oi of [i0, i1, i2] as const) {
        let ni = localMap.get(oi)
        if (ni === undefined) {
          v.copyFromFloats(positions[oi * 3], positions[oi * 3 + 1], positions[oi * 3 + 2])
          const vt = Vector3.TransformCoordinates(v, invBind)
          ni = nextIdx++
          localMap.set(oi, ni)
          outPositions.push(vt.x, vt.y, vt.z)
          if (normalsSrc) {
            n.copyFromFloats(normalsSrc[oi * 3], normalsSrc[oi * 3 + 1], normalsSrc[oi * 3 + 2])
            // TransformNormal ignores translation — correct for direction vectors.
            const nt = Vector3.TransformNormal(n, invBind)
            nt.normalize()
            outNormals.push(nt.x, nt.y, nt.z)
          }
        }
        outIndices.push(ni)
      }
    }
  }

  console.log(`[creator] clone '${boneName}': extracted ${totalTris} triangles, ${outPositions.length / 3} vertices`)
  if (totalTris === 0) return null
  const positionsArr = new Float32Array(outPositions)
  let normals: number[]
  if (normalsAvailable && outNormals.length === outPositions.length) {
    normals = outNormals
  } else {
    normals = []
    VertexData.ComputeNormals(positionsArr, outIndices, normals)
  }
  return { positions: positionsArr, indices: outIndices, normals, firstSourceMaterial }
}

// Find a (Bone, referenceMesh) pair on a model that owns the named
// bone. Used by Custom for attachToBone. The reference mesh anchors
// the bone-attached geometry to scene world via mesh.world matrix.
function findSkin(model: ModelInstance, boneName: string): { bone: Bone; refMesh: AbstractMesh } | null {
  for (const m of model.glbMeshes) {
    if (!(m instanceof Mesh)) continue
    if (m.getTotalVertices() === 0) continue
    if (!m.skeleton) continue
    const bone = m.skeleton.bones.find((b) => b.name === boneName)
    if (bone) return { bone, refMesh: m }
  }
  return null
}

// TransformNode link for primitives — same path the bone-picker uses.
function findLinkedNode(model: ModelInstance, boneName: string): TransformNode | null {
  const bone = model.skeleton.bones.find((b) => b.name === boneName)
  return (bone?._linkedTransformNode as TransformNode | undefined) ?? null
}

// Dispose mesh + material. Critical — each part has its own material
// (not in matCache) so it MUST be disposed alongside the mesh. For group
// parts, dispose every child + its material before the group root.
export function disposePartMesh(inst: CreatorPartInstance): void {
  if (inst.groupChildren) {
    for (const c of inst.groupChildren) {
      c.mesh.dispose()
      c.material.dispose()
    }
  }
  inst.mesh.dispose()
  // The primary material reference for groups points at the first child's
  // material (already disposed in the loop above). Safe-dispose: idempotent.
  if (!inst.groupChildren) inst.material.dispose()
}

// Apply a hex colour to either a StandardMaterial (diffuseColor +
// ambientColor) or a PBRMaterial (albedoColor). For PBR materials with
// an albedoTexture, this tints the texture rather than replacing it.
function applyColor(mat: any, hex: string): void {
  const c = Color3.FromHexString(hex)
  if ('diffuseColor' in mat) {
    mat.diffuseColor = c
    if ('ambientColor' in mat) mat.ambientColor = c.scale(0.5)
  } else if ('albedoColor' in mat) {
    mat.albedoColor = c
  }
}

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
const DEFAULT_COLOR_CLONE     = '#d9534f'  // red — distinct so a successful clone is obvious
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
    color: shape === 'clone' ? DEFAULT_COLOR_CLONE : DEFAULT_COLOR_PRIMITIVE,
  }
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
    return createClonePart(scene, part, customModel, sourceModel)
  }
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

  const geom = extractBoneGeometry(sourceModel, part.boneName)
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

  return wrapWithMaterial(scene, mesh, part)
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
  const needsTransform = !!patch.scale || !!patch.offset || !!patch.rotation || !!patch.boneName
  if (needsTransform) {
    if (next.shape === 'clone') {
      applyCloneTransform(inst.mesh, next.scale, next.offset, next.rotation)
    } else {
      const parent = inst.mesh.parent as TransformNode | null
      if (parent) applyPrimitiveTransform(inst.mesh, parent, next.scale, next.offset, next.rotation)
    }
  }
  if (patch.color) applyColor(inst.material, patch.color)
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

// Walk every skinned mesh on the source. For each triangle with at
// least one vertex meaningfully weighted (≥0.30) to the target bone,
// copy those vertices transformed into bone-local-skeleton space by
// bone.getAbsoluteInverseBindMatrix() (canonical Babylon skinning math).
// Returns null if no triangles qualify.
function extractBoneGeometry(
  source: ModelInstance,
  boneName: string,
): { positions: Float32Array; indices: number[]; normals: number[] } | null {
  const outPositions: number[] = []
  const outIndices: number[] = []
  let nextIdx = 0
  let totalTris = 0

  for (const m of source.glbMeshes) {
    if (!(m instanceof Mesh)) continue
    if (m.getTotalVertices() === 0) continue
    if (!m.skeleton) continue
    const boneIdx = m.skeleton.bones.findIndex((b) => b.name === boneName)
    if (boneIdx < 0) continue
    const bone = m.skeleton.bones[boneIdx]
    // Per-mesh inverse bind matrix — each skin in a multi-skin GLB may
    // have its own inverseBindMatrices that subtly differ.
    const invBind = bone.getAbsoluteInverseBindMatrix()

    const positions = m.getVerticesData(VertexBuffer.PositionKind)
    const mIdx = m.getVerticesData(VertexBuffer.MatricesIndicesKind)
    const mWts = m.getVerticesData(VertexBuffer.MatricesWeightsKind)
    const indices = m.getIndices()
    if (!positions || !mIdx || !mWts || !indices) continue

    const vCount = positions.length / 3
    const VERT_WEIGHT_THRESHOLD = 0.30
    const belongs = new Uint8Array(vCount)
    for (let v = 0; v < vCount; v++) {
      for (let k = 0; k < 4; k++) {
        if (mIdx[v * 4 + k] === boneIdx && mWts[v * 4 + k] >= VERT_WEIGHT_THRESHOLD) {
          belongs[v] = 1
          break
        }
      }
    }

    const localMap = new Map<number, number>()
    const triCount = (indices.length / 3) | 0
    const v = new Vector3()
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3]
      const i1 = indices[t * 3 + 1]
      const i2 = indices[t * 3 + 2]
      if (!belongs[i0] && !belongs[i1] && !belongs[i2]) continue
      totalTris++
      for (const oi of [i0, i1, i2] as const) {
        let ni = localMap.get(oi)
        if (ni === undefined) {
          v.copyFromFloats(positions[oi * 3], positions[oi * 3 + 1], positions[oi * 3 + 2])
          const transformed = Vector3.TransformCoordinates(v, invBind)
          ni = nextIdx++
          localMap.set(oi, ni)
          outPositions.push(transformed.x, transformed.y, transformed.z)
        }
        outIndices.push(ni)
      }
    }
  }

  console.log(`[creator] clone '${boneName}': extracted ${totalTris} triangles, ${outPositions.length / 3} vertices`)
  if (totalTris === 0) return null
  const positionsArr = new Float32Array(outPositions)
  const normals: number[] = []
  VertexData.ComputeNormals(positionsArr, outIndices, normals)
  return { positions: positionsArr, indices: outIndices, normals }
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
// (not in matCache) so it MUST be disposed alongside the mesh.
export function disposePartMesh(inst: CreatorPartInstance): void {
  inst.mesh.dispose()
  inst.material.dispose()
}

function applyColor(mat: StandardMaterial, hex: string): void {
  const c = Color3.FromHexString(hex)
  mat.diffuseColor = c
  mat.ambientColor = c.scale(0.5)
}

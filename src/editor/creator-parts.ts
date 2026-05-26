import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import type { CreatorPart, CreatorPartInstance, CreatorShape } from './editor-scene'

// Default dimensions per shape — sized so a freshly-added part is
// recognisable at the knight's scale (knight is ~1.8m tall). User can
// then refine via the Stepper UI. Scales are in metres (parent-local).
// Stored as WORLD-METRES (UI shows in cm = ×100). The mesh's local
// scaling/position is normalised by the parent bone's absolute world
// scale at apply-time, so what the user types is what they see.
export const DEFAULT_PART_DEFAULTS: Record<CreatorShape, {
  scale: [number, number, number]
  offset: [number, number, number]
}> = {
  sphere:   { scale: [0.08, 0.08, 0.08], offset: [0, 0, 0] },     // joint dot
  box:      { scale: [0.20, 0.30, 0.15], offset: [0, 0, 0] },     // torso slab
  cylinder: { scale: [0.08, 0.30, 0.08], offset: [0, 0.15, 0] },  // limb segment
  capsule:  { scale: [0.08, 0.30, 0.08], offset: [0, 0.15, 0] },  // rounded limb
}

const DEFAULT_COLOR = '#8a8d92'  // neutral grey

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
    color: DEFAULT_COLOR,
  }
}

// Build the primitive mesh + own material for a part, parent to the bone
// node, apply scale/offset/rotation/color. Returns the runtime instance
// to be stored on the model's creatorParts map.
//
// IMPORTANT: each part owns its OWN StandardMaterial — NOT shared with
// the knight matCache — so recolouring a part doesn't tint the whole rig.
export function createPartMesh(
  scene: Scene,
  part: CreatorPart,
  parentNode: TransformNode,
): CreatorPartInstance {
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
      mesh = MeshBuilder.CreateCylinder(
        meshName,
        { diameter: 1, height: 1, tessellation: 24 },
        scene,
      )
      break
    case 'capsule':
      mesh = MeshBuilder.CreateCapsule(
        meshName,
        { radius: 0.5, height: 1, tessellation: 24, subdivisions: 4 },
        scene,
      )
      break
  }

  // Parent BEFORE setting position/rotation/scaling so they're treated
  // as local-to-parent (not preserving previous world transform).
  mesh.parent = parentNode
  applyTransform(mesh, parentNode, part.scale, part.offset, part.rotation)
  // Not pickable — don't intercept clicks on the bone-picker spheres
  // sitting at the same world location.
  mesh.isPickable = false
  // Default rendering group — bone-picker spheres are on group 2 so they
  // still appear in front of any part, preserving bone-pick UX.
  mesh.renderingGroupId = 0
  mesh.metadata = { creatorPartId: part.id }

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
): CreatorPartInstance {
  const next: CreatorPart = { ...inst.data, ...patch }
  // Shape change → rebuild mesh + material
  if (patch.shape && patch.shape !== inst.data.shape) {
    const parentNode = inst.mesh.parent as TransformNode | null
    disposePartMesh(inst)
    if (!parentNode) {
      // Shouldn't happen — bone was disposed?
      throw new Error(`Cannot rebuild part ${inst.data.id}: parent missing`)
    }
    return createPartMesh(scene, next, parentNode)
  }
  // Mutating path — no rebuild. Re-normalise against parent world scale
  // every time so re-parented parts pick up the new bone's scale.
  const parent = inst.mesh.parent as TransformNode | null
  const needsTransform =
    !!patch.scale || !!patch.offset || !!patch.rotation || !!patch.boneName
  if (parent && needsTransform) {
    applyTransform(inst.mesh, parent, next.scale, next.offset, next.rotation)
  }
  if (patch.color) applyColor(inst.material, patch.color)
  inst.data = next
  return inst
}

// Normalise user-meters → bone-local units by dividing through the
// parent bone's absolute world scale. Without this, baked armature
// scaling (Blender → glTF mirror + root scale) makes "15cm" render as
// metres. abs() so the GLB's -Y mirror doesn't flip our offsets.
function applyTransform(
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
  mesh.rotation.copyFromFloats(
    rotation[0] * DEG2RAD,
    rotation[1] * DEG2RAD,
    rotation[2] * DEG2RAD,
  )
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

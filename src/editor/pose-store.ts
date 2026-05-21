import { Skeleton } from '@babylonjs/core'

// Bones for which we capture local position (alongside rotation). Hips is
// the only one for now — moving Hips lowers/leans the whole body without
// sliding the character root through the world, which is what we want for
// crouch / weight-shift / lean poses. Other bones stay rotation-only so
// limbs can't be stretched.
export const POSITION_BONES: readonly string[] = ['Hips']

export type Pose = {
  id: string
  name: string
  rotations: Record<string, [number, number, number, number]>
  positions?: Record<string, [number, number, number]>
}

export function snapshotPose(skeleton: Skeleton, name: string): Pose {
  const rotations: Record<string, [number, number, number, number]> = {}
  const positions: Record<string, [number, number, number]> = {}
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    node.rotationQuaternion =
      node.rotationQuaternion ?? node.rotation.toQuaternion()
    const q = node.rotationQuaternion
    rotations[bone.name] = [q.x, q.y, q.z, q.w]
    if (POSITION_BONES.includes(bone.name)) {
      const p = node.position
      positions[bone.name] = [p.x, p.y, p.z]
    }
  }
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pose_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name,
    rotations,
    positions,
  }
}

type Posable = {
  rotations: Record<string, [number, number, number, number]>
  positions?: Record<string, [number, number, number]>
}

export function applyPose(skeleton: Skeleton, pose: Posable): void {
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    const r = pose.rotations[bone.name]
    if (r) {
      if (!node.rotationQuaternion) {
        node.rotationQuaternion = node.rotation.toQuaternion()
      }
      node.rotationQuaternion.copyFromFloats(r[0], r[1], r[2], r[3])
    }
    const p = pose.positions?.[bone.name]
    if (p) node.position.copyFromFloats(p[0], p[1], p[2])
  }
}

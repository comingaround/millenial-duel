import { Skeleton } from '@babylonjs/core'

export type Pose = {
  id: string
  name: string
  rotations: Record<string, [number, number, number, number]>
}

export function snapshotPose(skeleton: Skeleton, name: string): Pose {
  const rotations: Record<string, [number, number, number, number]> = {}
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    node.rotationQuaternion =
      node.rotationQuaternion ?? node.rotation.toQuaternion()
    const q = node.rotationQuaternion
    rotations[bone.name] = [q.x, q.y, q.z, q.w]
  }
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `pose_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    name,
    rotations,
  }
}

type Posable = { rotations: Record<string, [number, number, number, number]> }

export function applyPose(skeleton: Skeleton, pose: Posable): void {
  for (const bone of skeleton.bones) {
    const node = bone._linkedTransformNode
    if (!node) continue
    const r = pose.rotations[bone.name]
    if (!r) continue
    if (!node.rotationQuaternion) {
      node.rotationQuaternion = node.rotation.toQuaternion()
    }
    node.rotationQuaternion.copyFromFloats(r[0], r[1], r[2], r[3])
  }
}

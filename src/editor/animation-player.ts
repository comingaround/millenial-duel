import {
  Animatable,
  Animation,
  Quaternion,
  Scene,
  Skeleton,
  Vector3,
} from '@babylonjs/core'

export type AnchorData = {
  rotations: Record<string, [number, number, number, number]>
  positions?: Record<string, [number, number, number]>
}

export type AnimationKeyframe = {
  anchor: AnchorData
  time: number   // seconds
}

const FPS = 30

// Plays a sequence of anchor keyframes by building a Babylon Animation
// per affected bone (rotationQuaternion track) and running them in sync.
// Returns the set of active Animatables so callers can stop if needed.
//
// Hips Y is the only position channel meant for body-shift use (crouch).
// Character world locomotion lives elsewhere (per-anim forwardStep + input).
export function playAnimation(
  scene: Scene,
  skeleton: Skeleton,
  keyframes: AnimationKeyframe[],
): Animatable[] {
  if (keyframes.length < 1) return []

  // 1) Sort by time + drop duplicates at the same time (Babylon doesn't like two
  // keys at the same frame; they just get overwritten and the curve breaks).
  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
  const cleaned: AnimationKeyframe[] = []
  for (const k of sorted) {
    if (cleaned.length > 0 && Math.abs(k.time - cleaned[cleaned.length - 1].time) < 0.001) {
      // skip near-duplicate
      continue
    }
    cleaned.push(k)
  }
  if (cleaned.length < 1) return []

  // 2) If the first keyframe isn't at time 0, treat the bones' CURRENT state
  // as the implicit start. So a single keyframe at time=0.5 means "blend
  // from where I am now to this pose over 0.5 seconds".
  const hasStart = cleaned[0].time <= 0.001
  const lastTime = cleaned[cleaned.length - 1].time
  if (lastTime <= 0) return []
  const totalFrames = Math.max(1, Math.ceil(lastTime * FPS))

  // Collect every bone referenced anywhere in any keyframe
  const boneNames = new Set<string>()
  const positionBoneNames = new Set<string>()
  for (const kf of cleaned) {
    for (const name of Object.keys(kf.anchor.rotations)) {
      boneNames.add(name)
    }
    if (kf.anchor.positions) {
      for (const name of Object.keys(kf.anchor.positions)) {
        positionBoneNames.add(name)
      }
    }
  }

  const animatables: Animatable[] = []

  for (const boneName of boneNames) {
    const bone = skeleton.bones.find((b) => b.name === boneName)
    const node = bone?._linkedTransformNode
    if (!node) continue
    if (!node.rotationQuaternion) {
      node.rotationQuaternion = node.rotation.toQuaternion()
    }

    const anim = new Animation(
      `editor_play_${boneName}`,
      'rotationQuaternion',
      FPS,
      Animation.ANIMATIONTYPE_QUATERNION,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    )
    const keys: Array<{ frame: number; value: Quaternion }> = []
    if (!hasStart) {
      // Frame 0 = current bone rotation (implicit start)
      keys.push({ frame: 0, value: node.rotationQuaternion.clone() })
    }
    for (const kf of cleaned) {
      const r = kf.anchor.rotations[boneName]
      if (!r) continue
      keys.push({
        frame: Math.round(kf.time * FPS),
        value: new Quaternion(r[0], r[1], r[2], r[3]),
      })
    }
    if (keys.length < 2) continue
    anim.setKeys(keys)
    const ani = scene.beginDirectAnimation(node, [anim], 0, totalFrames, false, 1.0)
    animatables.push(ani)
  }

  // Position tracks (Hips only in practice). Mirrors the rotation loop:
  // implicit frame-0 keyframe = current node.position when no explicit start.
  for (const boneName of positionBoneNames) {
    const bone = skeleton.bones.find((b) => b.name === boneName)
    const node = bone?._linkedTransformNode
    if (!node) continue

    const anim = new Animation(
      `editor_pos_${boneName}`,
      'position',
      FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    )
    const keys: Array<{ frame: number; value: Vector3 }> = []
    if (!hasStart) {
      keys.push({ frame: 0, value: node.position.clone() })
    }
    for (const kf of cleaned) {
      const p = kf.anchor.positions?.[boneName]
      if (!p) continue
      keys.push({
        frame: Math.round(kf.time * FPS),
        value: new Vector3(p[0], p[1], p[2]),
      })
    }
    if (keys.length < 2) continue
    anim.setKeys(keys)
    const ani = scene.beginDirectAnimation(node, [anim], 0, totalFrames, false, 1.0)
    animatables.push(ani)
  }

  return animatables
}

export function stopAnimation(animatables: Animatable[]) {
  for (const a of animatables) a.stop()
}

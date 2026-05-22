import {
  AbstractMesh,
  Animatable,
  Animation,
  Quaternion,
  Scene,
  Skeleton,
  TransformNode,
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
// `locomotionRoot` (optional): if provided, Hips bone X/Z translation gets
// "promoted" to the root mesh's world position (character physically advances),
// while Hips bone X/Z snap back to rest so the body doesn't visually slide.
// Hips Y stays on the Hips bone (crouch / body shift).
// Pass undefined to play purely as bone animation (e.g. editor preview).
export function playAnimation(
  scene: Scene,
  skeleton: Skeleton,
  keyframes: AnimationKeyframe[],
  locomotionRoot?: AbstractMesh | TransformNode,
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

  // Position tracks (Hips only in practice). Mirrors the rotation loop.
  // When locomotionRoot is provided AND this is the Hips bone, X/Z components
  // of the authored Hips position get promoted to a root.position track
  // (character physically moves) and the Hips bone keys keep only the Y
  // component (so the body's vertical shift / crouch is preserved).
  for (const boneName of positionBoneNames) {
    const bone = skeleton.bones.find((b) => b.name === boneName)
    const node = bone?._linkedTransformNode
    if (!node) continue

    const promoteXZ = !!locomotionRoot && boneName === 'Hips'
    const restPos = node.position.clone()  // captures local-parent rest

    // --- Hips bone position track (Y always, X/Z only when not promoting) ---
    const boneAnim = new Animation(
      `editor_pos_${boneName}`,
      'position',
      FPS,
      Animation.ANIMATIONTYPE_VECTOR3,
      Animation.ANIMATIONLOOPMODE_CONSTANT,
    )
    const boneKeys: Array<{ frame: number; value: Vector3 }> = []
    if (!hasStart) {
      boneKeys.push({ frame: 0, value: node.position.clone() })
    }
    for (const kf of cleaned) {
      const p = kf.anchor.positions?.[boneName]
      if (!p) continue
      const v = promoteXZ
        ? new Vector3(restPos.x, p[1], restPos.z)   // keep only Y from authored
        : new Vector3(p[0], p[1], p[2])
      boneKeys.push({ frame: Math.round(kf.time * FPS), value: v })
    }
    if (boneKeys.length >= 2) {
      boneAnim.setKeys(boneKeys)
      const ani = scene.beginDirectAnimation(node, [boneAnim], 0, totalFrames, false, 1.0)
      animatables.push(ani)
    }

    // --- Root position track (only for Hips when locomotion is on) ---
    if (promoteXZ && locomotionRoot) {
      // Transform Hips local-parent XZ delta into world-space displacement
      // using the root's rotation (so a "step right" on the editor knight
      // becomes "step right relative to the character" on a rotated hero).
      const rootStart = locomotionRoot.position.clone()
      const rootKeys: Array<{ frame: number; value: Vector3 }> = []
      if (!hasStart) {
        rootKeys.push({ frame: 0, value: rootStart.clone() })
      }
      for (const kf of cleaned) {
        const p = kf.anchor.positions?.[boneName]
        if (!p) continue
        // Local-parent delta from rest, X and Z only
        const localDelta = new Vector3(p[0] - restPos.x, 0, p[2] - restPos.z)
        // Convert through root's rotation. Vector3.TransformNormal applies
        // the rotation portion of a world matrix to a direction vector.
        const worldDelta = Vector3.TransformNormal(
          localDelta,
          locomotionRoot.getWorldMatrix(),
        )
        rootKeys.push({
          frame: Math.round(kf.time * FPS),
          value: rootStart.add(worldDelta),
        })
      }
      if (rootKeys.length >= 2) {
        const rootAnim = new Animation(
          `editor_root_locomote`,
          'position',
          FPS,
          Animation.ANIMATIONTYPE_VECTOR3,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
        )
        rootAnim.setKeys(rootKeys)
        const ani = scene.beginDirectAnimation(locomotionRoot, [rootAnim], 0, totalFrames, false, 1.0)
        animatables.push(ani)
      }
    }
  }

  return animatables
}

export function stopAnimation(animatables: Animatable[]) {
  for (const a of animatables) a.stop()
}

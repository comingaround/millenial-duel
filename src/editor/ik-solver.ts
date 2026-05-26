import { Quaternion, Vector3 } from '@babylonjs/core'

// Analytical two-bone IK solver. Given a chain root (shoulder/hip),
// mid joint (elbow/knee), and end effector (hand/foot), compute the
// rotations of the upper and lower bone that make the end effector
// reach a target world position.
//
// Uses the law of cosines for joint angles. Pole hint direction tells
// the solver which way to bend the joint (forward for knees, away from
// body for elbows).
//
// All positions and the pole hint are in WORLD space.

export type TwoBoneIkResult = {
  // Rotation deltas in world space (for delta-based application paths).
  upperRotation: Quaternion
  midRotation: Quaternion
  // Solver's intended joint positions in world space — for position-based
  // application paths that avoid rotation-extraction from scaled matrices.
  newMidPos: Vector3   // where the knee/elbow should end up
  newEndPos: Vector3   // where the foot/hand should end up (= target if reachable)
}

// Solve the two-bone chain. Returns world-space rotations for the upper
// bone (about its origin) and the mid bone (relative to the upper, also
// world-space — caller transforms to local).
export function solveTwoBoneIK(
  rootPos: Vector3,
  midRestPos: Vector3,
  endRestPos: Vector3,
  targetPos: Vector3,
  poleHint: Vector3,
): TwoBoneIkResult {
  // Bone lengths from rest pose
  const upperLen = Vector3.Distance(rootPos, midRestPos)
  const lowerLen = Vector3.Distance(midRestPos, endRestPos)

  // Vector from root to target
  let toTarget = targetPos.subtract(rootPos)
  let targetDist = toTarget.length()

  // Clamp: if target is unreachable (too far), straighten the chain
  // toward it. If too close, set distance to a small minimum to avoid
  // degenerate triangle.
  const maxReach = upperLen + lowerLen - 1e-4
  const minReach = Math.max(Math.abs(upperLen - lowerLen) + 1e-4, 1e-4)
  if (targetDist > maxReach) targetDist = maxReach
  if (targetDist < minReach) targetDist = minReach
  const toTargetDir = toTarget.scale(1 / Math.max(toTarget.length(), 1e-6))

  // Angle at the root: law of cosines
  //   cos(A) = (a² + c² - b²) / (2ac)
  // where a = upperLen, b = lowerLen, c = targetDist
  const cosA = (upperLen * upperLen + targetDist * targetDist - lowerLen * lowerLen)
    / (2 * upperLen * targetDist)
  const A = Math.acos(Math.max(-1, Math.min(1, cosA)))

  // Build a coordinate frame at the root:
  //   forward = toTargetDir
  //   up = poleHint projected to be perpendicular to forward
  //   side = forward × up
  let up = poleHint.subtract(toTargetDir.scale(Vector3.Dot(poleHint, toTargetDir)))
  if (up.lengthSquared() < 1e-6) {
    // Pole hint parallel to target direction — fallback to world up
    up = new Vector3(0, 1, 0).subtract(toTargetDir.scale(Vector3.Dot(new Vector3(0, 1, 0), toTargetDir)))
    if (up.lengthSquared() < 1e-6) up = new Vector3(1, 0, 0)
  }
  up.normalize()

  // Position of the mid joint in world space:
  //   along toTarget, then offset toward pole by sin(A) * upperLen
  const midOnAxis = upperLen * Math.cos(A)
  const midOffset = upperLen * Math.sin(A)
  const midPos = rootPos
    .add(toTargetDir.scale(midOnAxis))
    .add(up.scale(midOffset))

  // Final end position (should equal targetPos within clamp tolerance)
  const endPos = rootPos.add(toTargetDir.scale(targetDist))

  // Upper bone: rotation that aligns its REST direction (midRest - root)
  // with the new direction (midPos - root).
  const restUpperDir = midRestPos.subtract(rootPos).normalize()
  const newUpperDir = midPos.subtract(rootPos).normalize()
  const upperRotation = rotationFromTo(restUpperDir, newUpperDir)

  // Mid bone: rotation aligning rest (endRest - midRest) with new
  // (endPos - midPos). World-space — caller transforms.
  const restLowerDir = endRestPos.subtract(midRestPos).normalize()
  const newLowerDir = endPos.subtract(midPos).normalize()
  const midRotation = rotationFromTo(restLowerDir, newLowerDir)

  return { upperRotation, midRotation, newMidPos: midPos, newEndPos: endPos }
}

// Quaternion that rotates direction `from` to direction `to`.
// Both must be unit vectors.
function rotationFromTo(from: Vector3, to: Vector3): Quaternion {
  const d = Vector3.Dot(from, to)
  if (d > 0.999999) return Quaternion.Identity()
  if (d < -0.999999) {
    // 180° rotation around any axis perpendicular to `from`
    let axis = Vector3.Cross(new Vector3(1, 0, 0), from)
    if (axis.lengthSquared() < 1e-6) axis = Vector3.Cross(new Vector3(0, 1, 0), from)
    axis.normalize()
    return Quaternion.RotationAxis(axis, Math.PI)
  }
  const axis = Vector3.Cross(from, to)
  axis.normalize()
  const angle = Math.acos(Math.max(-1, Math.min(1, d)))
  return Quaternion.RotationAxis(axis, angle)
}

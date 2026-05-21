import { GizmoManager, Scene, Skeleton } from '@babylonjs/core'

export type EditorGizmo = {
  attach: (boneName: string) => void
  detach: () => void
  setActive: (active: boolean) => void
  dispose: () => void
}

export function createEditorGizmo(
  scene: Scene,
  skeleton: Skeleton,
): EditorGizmo {
  const gm = new GizmoManager(scene)
  gm.rotationGizmoEnabled = false
  gm.usePointerToAttachGizmos = false
  if (gm.gizmos.rotationGizmo) {
    gm.gizmos.rotationGizmo.updateGizmoRotationToMatchAttachedMesh = true
    gm.gizmos.rotationGizmo.snapDistance = 0
  }

  const attach = (boneName: string) => {
    const bone = skeleton.bones.find((b) => b.name === boneName)
    const node = bone?._linkedTransformNode
    if (!node) return
    node.rotationQuaternion =
      node.rotationQuaternion ?? node.rotation.toQuaternion()
    gm.attachToNode(node)
  }

  const detach = () => {
    gm.attachToNode(null)
  }

  return {
    attach,
    detach,
    setActive: (active: boolean) => {
      gm.rotationGizmoEnabled = active
      if (!active) gm.attachToNode(null)
    },
    dispose: () => gm.dispose(),
  }
}

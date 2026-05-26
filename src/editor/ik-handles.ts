import {
  AbstractMesh,
  Color3,
  Mesh,
  MeshBuilder,
  PickingInfo,
  PointerEventTypes,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

// Draggable IK handle — a small sphere that follows a specific bone's
// world position, and when grabbed, lets the user drag it to a new
// world position. The drag is projected onto a plane perpendicular to
// the camera through the handle's start position (industry-standard
// "screen-aligned" drag for 3D handles).
//
// Callers receive callbacks: onGrab (with current world pos) and onDrag
// (with new world pos each pointer move). They run IK math and apply.

export type IkHandle = {
  name: string             // diagnostic / per-bone tag
  mesh: Mesh               // the visible sphere
  setWorldPosition: (p: Vector3) => void   // for following the bone each frame
  setActive: (a: boolean) => void          // show/hide
  dispose: () => void
}

export type IkHandleCallbacks = {
  onGrab?: (worldPos: Vector3) => void
  onDrag?: (worldPos: Vector3) => void
  onRelease?: () => void
}

export function createIkHandle(
  scene: Scene,
  name: string,
  color: Color3,
  diameter: number,
  cbs: IkHandleCallbacks,
): IkHandle {
  const mesh = MeshBuilder.CreateSphere(`ik_handle_${name}`, { diameter, segments: 12 }, scene)
  const mat = new StandardMaterial(`ik_handle_mat_${name}`, scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(0.4)
  mat.specularColor = new Color3(0.2, 0.2, 0.2)
  mat.disableLighting = false
  mesh.material = mat
  mesh.isVisible = false
  mesh.isPickable = true
  // Render on top so handles aren't occluded by the body mesh
  mesh.renderingGroupId = 1

  let dragging = false
  let dragPlaneNormal = new Vector3(0, 0, 1)
  let dragPlanePoint = new Vector3()

  // Project a screen pick ray onto our drag plane → world point
  const projectPickToPlane = (pickInfo: PickingInfo | null): Vector3 | null => {
    const ray = pickInfo?.ray
    if (!ray) return null
    const denom = Vector3.Dot(ray.direction, dragPlaneNormal)
    if (Math.abs(denom) < 1e-6) return null
    const t = Vector3.Dot(dragPlanePoint.subtract(ray.origin), dragPlaneNormal) / denom
    if (t < 0) return null
    return ray.origin.add(ray.direction.scale(t))
  }

  const pointerHandler = (evt: any) => {
    const pi: PickingInfo | null = evt.pickInfo ?? null
    if (evt.type === PointerEventTypes.POINTERDOWN) {
      // Only start drag if the user picked OUR sphere
      if (pi?.pickedMesh !== mesh) return
      dragging = true
      // Set the drag plane: perpendicular to camera forward, through handle pos
      const cam = scene.activeCamera
      if (!cam) return
      const camForward = cam.getDirection(new Vector3(0, 0, 1))
      dragPlaneNormal = camForward.normalize()
      dragPlanePoint = mesh.position.clone()
      cbs.onGrab?.(mesh.position.clone())
      // Prevent the camera from grabbing this pointer
      if (cam && (cam as any).inputs) {
        scene.activeCamera?.detachControl()
      }
    } else if (evt.type === PointerEventTypes.POINTERMOVE) {
      if (!dragging) return
      const newPos = projectPickToPlane(pi)
      if (newPos) {
        mesh.position.copyFrom(newPos)
        cbs.onDrag?.(newPos)
      }
    } else if (evt.type === PointerEventTypes.POINTERUP) {
      if (!dragging) return
      dragging = false
      cbs.onRelease?.()
      // Re-attach camera control. The engine sets activeCamera; just
      // reattach on whatever the active camera is.
      const cv = scene.getEngine().getRenderingCanvas()
      if (cv && scene.activeCamera) scene.activeCamera.attachControl(cv, false)
    }
  }

  const obs = scene.onPointerObservable.add(pointerHandler)

  return {
    name,
    mesh,
    setWorldPosition: (p: Vector3) => {
      mesh.position.copyFrom(p)
    },
    setActive: (a: boolean) => {
      mesh.isVisible = a
      mesh.isPickable = a
    },
    dispose: () => {
      scene.onPointerObservable.remove(obs)
      mesh.dispose()
      mat.dispose()
    },
  }
}

// Helper: get world position of a bone via its linked transform node.
export function getBoneWorldPosition(skeleton: any, boneName: string): Vector3 | null {
  const bone = skeleton.bones.find((b: any) => b.name === boneName)
  const node: AbstractMesh = bone?._linkedTransformNode
  if (!node) return null
  node.computeWorldMatrix(true)
  return node.getAbsolutePosition().clone()
}

import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  Quaternion,
  Scene,
  Space,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core'
import { setupLighting } from './lighting'
import { createSky, createSun, HORIZON_COLOR } from './sky'
import { createClouds } from './clouds'
import { createGround } from './scene/ground'
import { createTrees } from './scene/trees'
import { createBuildings } from './scene/buildings'
import { createOpponent } from './characters/opponent'
import { createHero } from './characters/hero'
import { ACTIVE_BONES, createEditorScene, loadWeaponLibrary } from '../editor/editor-scene'
import type { CreatorPart, CreatorShape } from '../editor/editor-scene'
import {
  createPartMesh,
  defaultPartFor,
  disposePartMesh,
  updatePartMesh,
} from '../editor/creator-parts'
import { createBonePicker } from '../editor/bone-picker'
import { createEditorGizmo } from '../editor/gizmo'
import { applyPose, snapshotPose, POSITION_BONES } from '../editor/pose-store'
import { solveTwoBoneIK } from '../editor/ik-solver'
import {
  AnimationKeyframe,
  playAnimation,
  stopAnimation,
} from '../editor/animation-player'
import type { Animatable } from '@babylonjs/core'

export type SceneHandle = {
  engine: Engine
  scene: Scene
}

export function createEngine(
  canvas: HTMLCanvasElement,
  onReady: (h: SceneHandle) => void,
): () => void {
  console.log('[BJS] init')

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: true,
    antialias: true,
  })

  const scene = new Scene(engine)
  // Safety fill if sky is somehow missing — same color as horizon haze.
  scene.clearColor = new Color4(HORIZON_COLOR.r, HORIZON_COLOR.g, HORIZON_COLOR.b, 1.0)
  scene.ambientColor = new Color3(0.6, 0.62, 0.6)

  // No fog — grass stays full green to the horizon (reference look).
  scene.fogMode = Scene.FOGMODE_NONE

  // Initial duel stance: opponent at (0, 0, -5) facing -Z. Hero/camera
  // sits 2m in front of his face (z=-7) at his head height (y≈1.75),
  // looking straight at him.
  //   Left-drag  → orbit around target (look around)
  //   Right-drag → pan target
  //   Wheel      → zoom in/out
  //   Arrow keys → walk forward/back/strafe
  const camera = new ArcRotateCamera(
    'cam',
    -Math.PI / 2,            // looking from -Z toward +Z
    Math.PI / 2 - 0.05,      // nearly horizontal — eye level
    3,                       // 3m from target (hero stands behind at z=-8)
    new Vector3(0, 1.85, -5),// opponent's head (1.2× scaled knight)
    scene,
  )
  camera.fov = 1.0
  camera.attachControl(canvas, false)  // false → preventDefault so page doesn't scroll on wheel

  // Orbit / pitch limits — let user look mostly anywhere but stay above ground
  camera.lowerBetaLimit = 0.05
  camera.upperBetaLimit = Math.PI / 2 - 0.02

  // Zoom range — close inspection to wide overview
  camera.lowerRadiusLimit = 1.5
  camera.upperRadiusLimit = 300

  // Wheel zoom — bigger % = bigger steps per notch
  camera.wheelDeltaPercentage = 0.05

  // Pan (right-drag) — lower number = more responsive
  camera.panningSensibility = 80
  camera.panningInertia = 0.85

  // Orbit feel
  camera.inertia = 0.85
  camera.angularSensibilityX = 800
  camera.angularSensibilityY = 800

  camera.minZ = 0.1
  camera.maxZ = 2000

  // --- Second camera: Locked / FPS-style. Pinned to the hero's Head bone
  // each frame. Mouse moves the look direction; arrow keys still pan target.
  const fpCam = new UniversalCamera('fp_cam', new Vector3(0, 1.85, -8), scene)
  fpCam.setTarget(new Vector3(0, 1.85, -5))
  fpCam.fov = 1.0
  fpCam.minZ = 0.05
  fpCam.maxZ = 2000
  fpCam.angularSensibility = 4000
  // Disable WASD on the FPS camera (don't want keyboard to move it)
  fpCam.inputs.removeByType('FreeCameraKeyboardMoveInput')

  // --- Third camera: Editor. Orbits the editor area (Model 1 + Model 2). ---
  const editorCam = new ArcRotateCamera(
    'editor_cam',
    Math.PI / 2,             // looking from +Z; models face each other along X
    Math.PI / 2.4,
    5,
    new Vector3(51.5, 1.0, 0),   // centred across all three models (50, 51.5, 53)
    scene,
  )
  editorCam.fov = 0.9
  editorCam.minZ = 0.05
  editorCam.maxZ = 2000
  // Relaxed zoom range — user can fly very close (inspect a single bone)
  // or pull way back (frame all 3 models + the village). Previously
  // lowerRadiusLimit = 1.5 felt "stuck at the centre" because wheel-in
  // hit the cap a quarter-second after starting.
  editorCam.lowerRadiusLimit = 0.1
  editorCam.upperRadiusLimit = 500
  // Beta (vertical orbit) — give the full top-to-bottom range so the
  // user can look down from above OR up from below.
  editorCam.lowerBetaLimit = 0.05
  editorCam.upperBetaLimit = Math.PI - 0.05
  editorCam.wheelDeltaPercentage = 0.05
  editorCam.panningSensibility = 100

  let cameraMode: 'free' | 'locked' | 'editor' = 'free'
  scene.activeCamera = camera

  // Will be populated when editor scene finishes loading
  let bonePicker: ReturnType<typeof createBonePicker> | null = null
  let editorGizmo: ReturnType<typeof createEditorGizmo> | null = null

  const setCameraMode = (mode: 'free' | 'locked' | 'editor') => {
    cameraMode = mode
    camera.detachControl()
    fpCam.detachControl()
    editorCam.detachControl()
    bonePicker?.setActive(false)
    if (mode === 'free') {
      scene.activeCamera = camera
      camera.attachControl(canvas, false)
    } else if (mode === 'locked') {
      scene.activeCamera = fpCam
      fpCam.attachControl(canvas, false)
    } else {
      scene.activeCamera = editorCam
      editorCam.attachControl(canvas, false)
      bonePicker?.setActive(true)
    }
  }

  // Each frame in locked mode, snap the FPS camera to the hero's head bone.
  // Rotation is controlled by mouse (via UniversalCamera's built-in pointer
  // input) so we only override position.
  scene.onBeforeRenderObservable.add(() => {
    if (cameraMode !== 'locked') return
    const head = (window as any).__hero?.getHeadNode?.()
    if (!head) return
    head.computeWorldMatrix(true)
    fpCam.position.copyFrom(head.getAbsolutePosition())
  })

  // --- Arrow-key movement (pans camera target relative to view direction).
  // Mouse left-drag orbits, right-drag pans, wheel zooms. ---
  const keys = { fwd: false, back: false, left: false, right: false }
  const arrowSet = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
  const setKey = (k: string, down: boolean) => {
    if (k === 'ArrowUp')    keys.fwd = down
    if (k === 'ArrowDown')  keys.back = down
    if (k === 'ArrowLeft')  keys.left = down
    if (k === 'ArrowRight') keys.right = down
  }
  const onKeyDown = (e: KeyboardEvent) => {
    // Don't swallow keystrokes when a form input is focused — the user is
    // typing / navigating inside a number/text field.
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      return
    }
    if (arrowSet.has(e.key)) { e.preventDefault(); setKey(e.key, true); return }
    // Editor undo / redo. Checked before custom-anim bindings so a user-bound
    // 'z' or 'y' key doesn't swallow the shortcut.
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); (window as any).__editor?.undo?.(); return }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); (window as any).__editor?.redo?.(); return }
    }
    // Check custom animation bindings first
    const customAnims = (window as any).__customAnims as
      | Array<{
          heroKey?: string
          oppKey?: string
          resolved: any[]
          initialPose?: {
            rotations: Record<string, [number, number, number, number]>
            positions?: Record<string, [number, number, number]>
          } | null
        }>
      | undefined
    const key = e.key.toLowerCase()
    if (customAnims) {
      for (const ca of customAnims) {
        if (ca.heroKey && ca.heroKey === key) {
          (window as any).__hero?.playCustomAnimation?.(ca.resolved, ca.initialPose ?? undefined)
          return
        }
        if (ca.oppKey && ca.oppKey === key) {
          (window as any).__opponent?.playCustomAnimation?.(ca.resolved, ca.initialPose ?? undefined)
          return
        }
      }
    }
    // Legacy hardcoded Q/U/Space/Enter bindings removed — combat actions
    // are now authored in the editor and bound to user-chosen keys via the
    // animation row's Hero/Opp key inputs.
  }
  const onKeyUp = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
      return
    }
    if (arrowSet.has(e.key)) { e.preventDefault(); setKey(e.key, false) }
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const MOVE_SPEED = 0.18
  scene.onBeforeRenderObservable.add(() => {
    if (!keys.fwd && !keys.back && !keys.left && !keys.right) return
    const forward = camera.target.subtract(camera.position)
    forward.y = 0
    if (forward.lengthSquared() < 1e-6) return
    forward.normalize()
    const right = new Vector3(-forward.z, 0, forward.x)
    let dx = 0, dz = 0
    if (keys.fwd)   { dx += forward.x * MOVE_SPEED; dz += forward.z * MOVE_SPEED }
    if (keys.back)  { dx -= forward.x * MOVE_SPEED; dz -= forward.z * MOVE_SPEED }
    if (keys.right) { dx += right.x   * MOVE_SPEED; dz += right.z   * MOVE_SPEED }
    if (keys.left)  { dx -= right.x   * MOVE_SPEED; dz -= right.z   * MOVE_SPEED }
    camera.target.x += dx
    camera.target.z += dz
  })

  setupLighting(scene)
  createSky(scene)
  createSun(scene)
  createClouds(scene)
  createGround(scene)
  createTrees(scene)
  createBuildings(scene)
  // Load the weapon library FIRST so hero (and later opponent) can equip
  // an axe instead of the stock sword baked into knight.glb. Browser-cached
  // — the editor scene also loadWeaponLibrary's, but the fetch dedupes.
  loadWeaponLibrary(scene).then((weaponLibrary) => {
    createHero(scene, weaponLibrary)
  })
  createOpponent(scene)

  // --- Editor: load TWO knights facing each other + wire bone picker etc ---
  createEditorScene(scene).then((ed) => {
    if (!ed) return

    // Active model index — bone control, anim playback, reset all operate
    // on this one. Switchable via __editor.setActiveModel(0|1).
    let activeIdx = 0
    const active = () => ed.models[activeIdx]

    // Creator parts revision — bumped on every mutation so React (or any
    // observer) can detect changes and persist. Pull-based (no events).
    let creatorPartsRev = 0
    const creatorPartsListeners: Array<() => void> = []
    const modelsChangeListeners: Array<() => void> = []
    // Tracks which model the editor camera is currently focused on.
    // -1 = no explicit focus (initial state, target at the static centre).
    let focusedModelIdx = -1
    const focusChangeListeners: Array<() => void> = []
    const bumpCreatorParts = () => {
      creatorPartsRev++
      for (const l of creatorPartsListeners) l()
    }

    bonePicker = createBonePicker(scene, active().skeleton, ACTIVE_BONES)
    editorGizmo = createEditorGizmo(scene, active().skeleton)
    editorGizmo.setActive(false)

    let currentSelection: string | null = null
    const boneSelectListeners: Array<(name: string | null) => void> = []

    const selectBone = (name: string | null) => {
      currentSelection = name
      bonePicker!.setSelected(name)
      boneSelectListeners.forEach((cb) => cb(name))
    }

    bonePicker.onSelect((boneName) => selectBone(boneName))

    const rotateSelectedBone = (axis: 'x' | 'y' | 'z', deltaRad: number) => {
      if (!currentSelection) return
      const bone = active().skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return
      node.rotationQuaternion =
        node.rotationQuaternion ?? node.rotation.toQuaternion()
      const ax =
        axis === 'x' ? new Vector3(1, 0, 0)
        : axis === 'y' ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1)
      const offset = Quaternion.RotationAxis(ax, deltaRad)
      node.rotationQuaternion = node.rotationQuaternion.multiply(offset)
    }

    // Helpers for leg-plant IK on Hips translation.
    const getBoneWorld = (boneName: string): Vector3 | null => {
      const m = active()
      const b = m.skeleton.bones.find((x) => x.name === boneName)
      const n = b?._linkedTransformNode
      if (!n) return null
      n.computeWorldMatrix(true)
      return n.getAbsolutePosition().clone()
    }

    // Transform a world position into a node's PARENT-LOCAL frame.
    // Babylon's Matrix.invert handles scaled/mirrored matrices correctly
    // for position transforms (unlike decompose, which fails for negative
    // scale axes from the GLB's Blender→glTF Z-up→Y-up conversion).
    const worldPosToParentLocal = (parent: any, worldPos: Vector3): Vector3 => {
      parent.computeWorldMatrix(true)
      const inv = parent.getWorldMatrix().clone()
      inv.invert()
      return Vector3.TransformCoordinates(worldPos, inv)
    }

    // Build a local rotation that aims the bone's child direction at a
    // target position (in PARENT-local space), PRESERVING TWIST around
    // the bone's length axis.
    //
    // Naive shortest-arc rotation (rotationFromTo) re-aims the bone but
    // randomizes its twist, which makes knees/feet rotate strangely. By
    // starting from the bone's REST local rotation (which has the correct
    // twist baked in) and adding only a swing delta in parent space, the
    // twist component stays consistent across IK calls.
    //
    // restLocalRot: bone's rest local rotation (in parent-local frame)
    // childLocalDir: direction to child in BONE-local frame (normalized)
    // boneLocalPos: bone's local position in parent-local frame
    // targetLocal: where the child should land in parent-local frame
    const buildSwingDeltaLocalRotation = (
      restLocalRot: Quaternion,
      childLocalDir: Vector3,
      boneLocalPos: Vector3,
      targetLocal: Vector3,
    ): Quaternion => {
      // Where the child IS at rest, in parent-local frame
      const restChildInParent = Vector3.Zero()
      childLocalDir.rotateByQuaternionToRef(restLocalRot, restChildInParent)
      const restDir = restChildInParent.normalizeToNew()

      // Where the child SHOULD be, in parent-local frame
      const desiredDir = targetLocal.subtract(boneLocalPos).normalize()

      // Shortest-arc swing in parent-local space
      const d = Vector3.Dot(restDir, desiredDir)
      let delta: Quaternion
      if (d > 0.999999) {
        delta = Quaternion.Identity()
      } else if (d < -0.999999) {
        let perp = Vector3.Cross(new Vector3(1, 0, 0), restDir)
        if (perp.lengthSquared() < 1e-6) perp = Vector3.Cross(new Vector3(0, 1, 0), restDir)
        perp.normalize()
        delta = Quaternion.RotationAxis(perp, Math.PI)
      } else {
        const axis = Vector3.Cross(restDir, desiredDir).normalize()
        const angle = Math.acos(Math.max(-1, Math.min(1, d)))
        delta = Quaternion.RotationAxis(axis, angle)
      }

      // Compose: apply rest first, then swing delta in parent frame.
      // Babylon convention a.multiply(b) = a * b, applied as "b first, then a".
      return delta.multiply(restLocalRot)
    }

    // Run 2-bone IK on one leg of the active model so its foot reaches
    // `footTarget` (world space). Adjusts Upper Leg + Lower Leg only;
    // Foot bone keeps its current local rotation.
    const runLegPlantIK = (side: 'L' | 'R', footTarget: Vector3) => {
      const m = active()
      const sk = m.skeleton
      const upperBone = sk.bones.find((b) => b.name === `Upper Leg.${side}`)
      const lowerBone = sk.bones.find((b) => b.name === `Lower Leg.${side}`)
      const footBone = sk.bones.find((b) => b.name === `Foot.${side}`)
      if (!upperBone || !lowerBone || !footBone) return
      const upperNode = upperBone._linkedTransformNode as any
      const lowerNode = lowerBone._linkedTransformNode as any
      const footNode = footBone._linkedTransformNode as any
      if (!upperNode || !lowerNode || !footNode) return

      // Current world chain positions (post-Hips-translate).
      upperNode.computeWorldMatrix(true)
      lowerNode.computeWorldMatrix(true)
      footNode.computeWorldMatrix(true)
      const rootPos = upperNode.getAbsolutePosition().clone()
      const midRestPos = lowerNode.getAbsolutePosition().clone()
      const endRestPos = footNode.getAbsolutePosition().clone()

      // Pole hint = character's forward direction (knee bends forward).
      // For this rig, the model's local +Z is its forward (confirmed
      // empirically — Model 1 with Y=-π/2 maps local +Z → world +X,
      // which matches its visual facing toward Model 2).
      m.root.computeWorldMatrix(true)
      const poleHint = m.root.getDirection(new Vector3(0, 0, 1)).normalize()

      const { newMidPos, newEndPos } = solveTwoBoneIK(
        rootPos, midRestPos, endRestPos, footTarget, poleHint,
      )

      // The bone's "child direction" in its OWN local frame = child's
      // local position normalized.
      const upperChildLocalDir = (lowerNode.position as Vector3).clone().normalize()
      const lowerChildLocalDir = (footNode.position as Vector3).clone().normalize()

      // Rest local rotations — the rig's authored "default" orientation
      // for each bone, including its natural twist. We anchor IK to this
      // so the bones don't roll/twist unpredictably when re-aimed.
      const toRestQ = (arr: [number, number, number, number] | undefined) =>
        arr ? new Quaternion(arr[0], arr[1], arr[2], arr[3]) : Quaternion.Identity()
      const upperRestLocal = toRestQ(m.restPose[`Upper Leg.${side}`])
      const lowerRestLocal = toRestQ(m.restPose[`Lower Leg.${side}`])

      // ─── UPPER BONE ───
      if (upperNode.parent) {
        const wantedMidLocal = worldPosToParentLocal(upperNode.parent, newMidPos)
        const upperLocalPos = upperNode.position as Vector3
        upperNode.rotationQuaternion = buildSwingDeltaLocalRotation(
          upperRestLocal, upperChildLocalDir, upperLocalPos, wantedMidLocal,
        )
      }

      // ─── LOWER BONE ───
      // Parent is Upper Leg — which just changed. Recompute its world.
      upperNode.computeWorldMatrix(true)
      if (lowerNode.parent) {
        lowerNode.parent.computeWorldMatrix(true)
        const wantedEndLocal = worldPosToParentLocal(lowerNode.parent, newEndPos)
        const lowerLocalPos = lowerNode.position as Vector3
        lowerNode.rotationQuaternion = buildSwingDeltaLocalRotation(
          lowerRestLocal, lowerChildLocalDir, lowerLocalPos, wantedEndLocal,
        )
      }

    }

    // Arm IK — hand is the end effector. Translate the desired hand
    // world position; Upper Arm + Lower Arm rotate to reach. Hand bone
    // itself isn't translated (its local position stays at rest); it
    // follows the chain naturally once the arm bones rotate.
    const runArmIK = (side: 'L' | 'R', handTarget: Vector3) => {
      const m = active()
      const sk = m.skeleton
      const upperBone = sk.bones.find((b) => b.name === `Upper Arm.${side}`)
      const lowerBone = sk.bones.find((b) => b.name === `Lower Arm.${side}`)
      const handBone  = sk.bones.find((b) => b.name === `Hand.${side}`)
      if (!upperBone || !lowerBone || !handBone) return
      const upperNode = upperBone._linkedTransformNode as any
      const lowerNode = lowerBone._linkedTransformNode as any
      const handNode  = handBone._linkedTransformNode  as any
      if (!upperNode || !lowerNode || !handNode) return

      upperNode.computeWorldMatrix(true)
      lowerNode.computeWorldMatrix(true)
      handNode.computeWorldMatrix(true)
      const rootPos    = upperNode.getAbsolutePosition().clone()
      const midRestPos = lowerNode.getAbsolutePosition().clone()
      const endRestPos = handNode.getAbsolutePosition().clone()

      // Pole hint: elbow droops downward (model's local -Y). Natural for
      // most reaching motions. May want side-specific tweak later for
      // overhead poses (e.g. local -Z for "elbow points back").
      m.root.computeWorldMatrix(true)
      const poleHint = m.root.getDirection(new Vector3(0, -1, 0)).normalize()

      const { newMidPos, newEndPos } = solveTwoBoneIK(
        rootPos, midRestPos, endRestPos, handTarget, poleHint,
      )

      const upperChildLocalDir = (lowerNode.position as Vector3).clone().normalize()
      const lowerChildLocalDir = (handNode.position  as Vector3).clone().normalize()
      const toRestQ = (arr: [number, number, number, number] | undefined) =>
        arr ? new Quaternion(arr[0], arr[1], arr[2], arr[3]) : Quaternion.Identity()
      const upperRestLocal = toRestQ(m.restPose[`Upper Arm.${side}`])
      const lowerRestLocal = toRestQ(m.restPose[`Lower Arm.${side}`])

      if (upperNode.parent) {
        const wantedMidLocal = worldPosToParentLocal(upperNode.parent, newMidPos)
        upperNode.rotationQuaternion = buildSwingDeltaLocalRotation(
          upperRestLocal, upperChildLocalDir,
          upperNode.position as Vector3, wantedMidLocal,
        )
      }

      upperNode.computeWorldMatrix(true)
      if (lowerNode.parent) {
        lowerNode.parent.computeWorldMatrix(true)
        const wantedEndLocal = worldPosToParentLocal(lowerNode.parent, newEndPos)
        lowerNode.rotationQuaternion = buildSwingDeltaLocalRotation(
          lowerRestLocal, lowerChildLocalDir,
          lowerNode.position as Vector3, wantedEndLocal,
        )
      }
    }

    const translateSelectedBone = (axis: 'x' | 'y' | 'z', delta: number) => {
      if (!currentSelection) return
      if (!POSITION_BONES.includes(currentSelection)) return

      const isHips = currentSelection === 'Hips'
      const isHandL = currentSelection === 'Hand.L'
      const isHandR = currentSelection === 'Hand.R'
      const isFootL = currentSelection === 'Foot.L'
      const isFootR = currentSelection === 'Foot.R'

      const axisVec =
        axis === 'x' ? new Vector3(1, 0, 0)
        : axis === 'y' ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1)

      // Hand IK path — compute new world target and run arm IK.
      // (Don't translate the Hand bone itself; it follows the chain.)
      if (isHandL || isHandR) {
        const side: 'L' | 'R' = isHandL ? 'L' : 'R'
        const current = getBoneWorld(`Hand.${side}`)
        if (!current) return
        runArmIK(side, current.add(axisVec.scale(delta)))
        return
      }

      // Foot IK path — same idea, but on the leg chain. Reuses the
      // exact same `runLegPlantIK` we use for Hips translation; only the
      // target differs (current foot + delta vs. captured pre-translate
      // foot pos).
      if (isFootL || isFootR) {
        const side: 'L' | 'R' = isFootL ? 'L' : 'R'
        const current = getBoneWorld(`Foot.${side}`)
        if (!current) return
        runLegPlantIK(side, current.add(axisVec.scale(delta)))
        return
      }

      // Hips path — translate the bone in world space, then run leg-plant
      // IK with pre-translate foot positions as targets.
      const bone = active().skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return

      let plantedL: Vector3 | null = null
      let plantedR: Vector3 | null = null
      if (isHips) {
        plantedL = getBoneWorld('Foot.L')
        plantedR = getBoneWorld('Foot.R')
      }

      const dir =
        axis === 'x' ? Vector3.Right()
        : axis === 'y' ? Vector3.Up()
        : Vector3.Forward()
      node.translate(dir, delta, Space.WORLD)

      if (isHips) {
        if (plantedL) runLegPlantIK('L', plantedL)
        if (plantedR) runLegPlantIK('R', plantedR)
      }
    }

    let activeAnimatables: Animatable[] = []
    const stopActiveAnimation = () => {
      if (activeAnimatables.length) {
        stopAnimation(activeAnimatables)
        activeAnimatables = []
      }
    }

    // Undo / Redo (cleared on active-model switch — snapshots are model-
    // specific in practice).
    const MAX_UNDO = 40
    type Snap = {
      rotations: Record<string, [number, number, number, number]>
      positions: Record<string, [number, number, number]>
    }
    const undoStack: Snap[] = []
    const redoStack: Snap[] = []
    const captureCurrent = (): Snap => {
      const s = snapshotPose(active().skeleton, '__snap__')
      return { rotations: s.rotations, positions: s.positions ?? {} }
    }
    const pushUndo = () => {
      undoStack.push(captureCurrent())
      if (undoStack.length > MAX_UNDO) undoStack.shift()
      redoStack.length = 0
    }
    const undo = () => {
      stopActiveAnimation()
      const prev = undoStack.pop()
      if (!prev) return false
      redoStack.push(captureCurrent())
      if (redoStack.length > MAX_UNDO) redoStack.shift()
      applyPose(active().skeleton, prev)
      return true
    }
    const redo = () => {
      stopActiveAnimation()
      const next = redoStack.pop()
      if (!next) return false
      undoStack.push(captureCurrent())
      if (undoStack.length > MAX_UNDO) undoStack.shift()
      applyPose(active().skeleton, next)
      return true
    }

    const getSelectedBoneEuler = () => {
      if (!currentSelection) return null
      const bone = active().skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node || !node.rotationQuaternion) return null
      const e = node.rotationQuaternion.toEulerAngles()
      const R2D = 180 / Math.PI
      return { x: e.x * R2D, y: e.y * R2D, z: e.z * R2D }
    }

    const getSelectedBonePosition = () => {
      if (!currentSelection) return null
      if (!POSITION_BONES.includes(currentSelection)) return null
      const m = active()
      const bone = m.skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return null
      const restWorld = m.restWorldPositions[currentSelection]
      if (!restWorld) return null
      node.computeWorldMatrix(true)
      const wp = node.getAbsolutePosition()
      return {
        x: wp.x - restWorld[0],
        y: wp.y - restWorld[1],
        z: wp.z - restWorld[2],
      }
    }

    // Baseline material colours are now stored on each material's
    // `metadata.baselineHex` (see editor-scene.ts loadKnightInstance) so
    // Reset reads from there instead of a scene-wide map.

    ;(window as any).__editor = {
      snapshot: (name: string) => snapshotPose(active().skeleton, name),
      apply: (pose: {
        rotations: Record<string, [number, number, number, number]>
        positions?: Record<string, [number, number, number]>
      }) => {
        stopActiveAnimation()
        applyPose(active().skeleton, pose)
      },
      reset: () => {
        stopActiveAnimation()
        const m = active()
        applyPose(m.skeleton, { rotations: m.restPose, positions: m.restPositions })
        m.root.position.copyFrom(m.position)
        selectBone(null)
      },
      // Reset every model's bones + world position back to its scene-load
      // defaults. Useful when sync-play left both fighters in odd states.
      resetAll: () => {
        stopActiveAnimation()
        for (const m of ed.models) {
          applyPose(m.skeleton, { rotations: m.restPose, positions: m.restPositions })
          m.root.position.copyFrom(m.position)
        }
        selectBone(null)
      },
      selectBone,
      rotateSelectedBone,
      translateSelectedBone,
      getSelectedBone: () => currentSelection,
      getActiveBones: () => ACTIVE_BONES.slice(),
      getAllBoneNames: () => ed.allBoneNames.slice(),
      addBoneSelectListener: (cb: (name: string | null) => void) => {
        boneSelectListeners.push(cb)
        return () => {
          const i = boneSelectListeners.indexOf(cb)
          if (i >= 0) boneSelectListeners.splice(i, 1)
        }
      },
      playAnimation: (keyframes: AnimationKeyframe[]) => {
        stopActiveAnimation()
        const m = active()
        activeAnimatables = playAnimation(scene, m.skeleton, keyframes, m.root)
      },
      // Play an animation on a SPECIFIC model (not necessarily the active
      // one). Used by the sync-play / combo player to fire two anims at
      // once — one per model — without touching active-model state.
      playAnimationOnModel: (
        modelIdx: number,
        keyframes: AnimationKeyframe[],
        initialPose?: {
          rotations: Record<string, [number, number, number, number]>
          positions?: Record<string, [number, number, number]>
        },
      ) => {
        if (modelIdx < 0 || modelIdx >= ed.models.length) return
        const m = ed.models[modelIdx]
        if (initialPose) applyPose(m.skeleton, initialPose)
        // Note: each call uses its own Animatables — they're returned but
        // we don't track them globally. Combo plays don't need stop control.
        playAnimation(scene, m.skeleton, keyframes, m.root)
      },
      // ABSOLUTE world position of the active model's root (metres).
      // Map-central, not model-relative — so you see where each model
      // actually is in the scene (Model 1 starts at X≈50, Model 2 at X≈51.5).
      getBodyPosition: () => {
        const m = active()
        m.root.computeWorldMatrix(true)
        return {
          x: m.root.position.x,
          y: m.root.position.y,
          z: m.root.position.z,
        }
      },
      stopAnimation: () => stopActiveAnimation(),
      listBakedAnimations: () =>
        ed.animationGroups.map((g: any) => ({
          name: g.name,
          from: g.from,
          to: g.to,
        })),
      importBakedAnimation: (
        animName: string,
        sampleCount = 0,
      ): { anchors: { name: string; rotations: Record<string, [number, number, number, number]> }[]; durations: number[] } | null => {
        const group = ed.animationGroups.find((g: any) =>
          g.name.toLowerCase().includes(animName.toLowerCase()),
        )
        if (!group) return null
        const fromFrame: number = group.from
        const toFrame: number = group.to
        const fps = 30
        let frames: number[] = []
        if (sampleCount === 0) {
          const set = new Set<number>()
          for (const ta of group.targetedAnimations) {
            const keys = ta.animation.getKeys()
            for (const k of keys) {
              if (k.frame >= fromFrame && k.frame <= toFrame) set.add(k.frame)
            }
          }
          frames = Array.from(set).sort((a, b) => a - b)
          if (frames.length < 2) frames = [fromFrame, toFrame]
        } else {
          for (let i = 0; i < sampleCount; i++) {
            const t = i / (sampleCount - 1)
            frames.push(Math.round(fromFrame + (toFrame - fromFrame) * t))
          }
        }
        stopActiveAnimation()
        group.start(false, 1.0)
        group.pause()
        const anchors: {
          name: string
          rotations: Record<string, [number, number, number, number]>
        }[] = []
        const durations: number[] = []
        // Sample from MODEL 1's skeleton (which the baked groups target).
        const m1 = ed.models[0]
        for (let i = 0; i < frames.length; i++) {
          group.goToFrame(frames[i])
          for (const s of m1.skeletons) s.prepare()
          const snap = snapshotPose(m1.skeleton, `${animName}_${i + 1}`)
          anchors.push({ name: snap.name, rotations: snap.rotations })
          durations.push((frames[i] - fromFrame) / fps)
        }
        group.stop()
        applyPose(m1.skeleton, { rotations: m1.restPose })
        return { anchors, durations }
      },
      pushUndo,
      undo,
      redo,
      canUndo: () => undoStack.length > 0,
      canRedo: () => redoStack.length > 0,
      getSelectedBoneEuler,
      getSelectedBonePosition,
      hasPositionControl: (boneName: string) => POSITION_BONES.includes(boneName),
      setBonePickerActive: (a: boolean) => bonePicker?.setActive(a),
      // Per-model material APIs — read/write the ACTIVE model's
      // matCache only, so recolouring one knight doesn't bleed into
      // the others.
      getEditorMaterials: () => {
        const m = active()
        if (!m?.matCache) return []
        return Array.from(m.matCache.entries()).map(([slot, mat]) => ({
          name: slot,
          hex: mat.diffuseColor?.toHexString?.() ?? '#888888',
        }))
      },
      setEditorMaterialColor: (matName: string, hex: string) => {
        const m = active()
        const mat = m?.matCache?.get(matName)
        if (!mat) return
        const c = Color3.FromHexString(hex)
        mat.diffuseColor = c
        mat.ambientColor = c.scale(0.5)
      },
      resetEditorMaterials: () => {
        const m = active()
        if (!m?.matCache) return
        for (const mat of m.matCache.values()) {
          const hex = (mat.metadata as any)?.baselineHex
          if (!hex) continue
          const c = Color3.FromHexString(hex)
          mat.diffuseColor = c
          mat.ambientColor = c.scale(0.5)
        }
      },
      // Diagnostic — read a bone's world position from the ACTIVE editor
      // model only (avoids hero/opp same-named-bone confusion).
      debugBoneWorld: (boneName: string) => {
        const m = active()
        const bone = m.skeleton.bones.find((b) => b.name === boneName)
        const node = bone?._linkedTransformNode as any
        if (!node) return null
        node.computeWorldMatrix(true)
        const p = node.getAbsolutePosition()
        const q = node.rotationQuaternion ?? node.rotation.toQuaternion()
        return {
          worldPos: [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)],
          localRot: [+q.x.toFixed(4), +q.y.toFixed(4), +q.z.toFixed(4), +q.w.toFixed(4)],
        }
      },
      // --- Multi-model management ---
      getModels: () => ed.models.map((m) => m.name),
      getActiveModelIndex: () => activeIdx,
      // Spawn another knight instance at runtime. Positions it 1.5m to the
      // right of the current rightmost model. Returns the new index, which
      // becomes the active model so the user can move it via the BODY
      // POSITION editor right away. Listeners fire so the React panel
      // refreshes the models list + visibilities.
      addModel: async (opts?: { hideAllMeshes?: boolean; name?: string }) => {
        const rightmost = ed.models.reduce(
          (a, b) => (b.position.x > a.position.x ? b : a),
          ed.models[0],
        )
        const pos = new Vector3(rightmost.position.x + 1.5, 0, 0)
        const yRot = rightmost ? -Math.PI / 2 : 0
        const name = opts?.name ?? `Model ${ed.models.length + 1}`
        const newIdx = await ed.addModel(name, pos, yRot, opts?.hideAllMeshes ?? false)
        for (const fn of modelsChangeListeners) fn()
        return newIdx
      },
      // Move active model's spawn anchor + snap root to it. Used by the
      // editable BODY POSITION fields so each model can spawn anywhere.
      setBodyPosition: (x: number, y: number, z: number) => {
        const m = active()
        m.position.copyFromFloats(x, y, z)
        m.root.position.copyFrom(m.position)
      },
      addModelsChangeListener: (fn: () => void) => {
        modelsChangeListeners.push(fn)
        return () => {
          const i = modelsChangeListeners.indexOf(fn)
          if (i >= 0) modelsChangeListeners.splice(i, 1)
        }
      },
      // Re-centre the editor camera on a model. Sets the orbit target to
      // the model's current root position + a chest-height offset (1.0m)
      // so wheel-zoom converges on the actual model instead of the static
      // spawn centre between all 3. Keeps current radius + angles so the
      // user doesn't get visually whipped around.
      focusModel: (idx: number) => {
        if (idx < 0 || idx >= ed.models.length) return
        const m = ed.models[idx]
        m.root.computeWorldMatrix(true)
        editorCam.target.copyFromFloats(
          m.root.position.x,
          m.root.position.y + 1.0,
          m.root.position.z,
        )
        focusedModelIdx = idx
        for (const fn of focusChangeListeners) fn()
      },
      getFocusedModelIdx: () => focusedModelIdx,
      addFocusChangeListener: (fn: () => void) => {
        focusChangeListeners.push(fn)
        return () => {
          const i = focusChangeListeners.indexOf(fn)
          if (i >= 0) focusChangeListeners.splice(i, 1)
        }
      },
      setActiveModel: (idx: number) => {
        if (idx < 0 || idx >= ed.models.length || idx === activeIdx) return
        activeIdx = idx
        // Rebuild bone picker for the new skeleton
        bonePicker?.dispose?.()
        bonePicker = createBonePicker(scene, active().skeleton, ACTIVE_BONES)
        bonePicker.onSelect((boneName) => selectBone(boneName))
        if (cameraMode === 'editor') bonePicker.setActive(true)
        selectBone(null)
        // Undo history is per-model; clear on switch
        undoStack.length = 0
        redoStack.length = 0
      },
      // Hide / show a model by toggling its root TransformNode. setEnabled
      // hides the whole hierarchy AND skips updates — cheap and complete.
      // Two follow-up toggles:
      //  1. Bone-picker spheres are scene-level (not parented to model
      //     root) so setEnabled on root alone leaves them floating.
      //  2. Skinned-clone creator parts are parented to a Bone via
      //     attachToBone — they're NOT in the model-root TransformNode
      //     hierarchy and don't inherit setEnabled. Toggle each part's
      //     mesh + groupChildren directly.
      setModelVisible: (idx: number, visible: boolean) => {
        if (idx < 0 || idx >= ed.models.length) return
        const m = ed.models[idx]
        m.root.setEnabled(visible)
        for (const inst of m.creatorParts.values()) {
          inst.mesh.setEnabled(visible)
          if (inst.groupChildren) {
            for (const c of inst.groupChildren) c.mesh.setEnabled(visible)
          }
        }
        if (idx === activeIdx && bonePicker) {
          bonePicker.setActive(visible && cameraMode === 'editor')
        }
      },
      getModelVisible: (idx: number) => {
        if (idx < 0 || idx >= ed.models.length) return true
        return ed.models[idx].root.isEnabled()
      },

      // ─── Character Creator (Model 3 / Custom) ────────────────────
      // Add a geometric primitive (or geometry clone) to a bone on the
      // Custom model. Returns the new part's id (or null if the bone
      // wasn't found / Custom model not loaded). Gated to Custom (idx 2).
      // For shape='clone', Model 1 is used as the geometry source.
      addCreatorPart: (shape: CreatorShape, boneName: string, meshFilter?: string[]): string | null => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return null
        const customModel = ed.models[customIdx]
        // Validate the bone exists on the Custom rig before constructing
        // the part — saves the rest of the pipeline from a sentinel value.
        if (!customModel.skeleton.bones.find((b) => b.name === boneName)) return null
        const part = defaultPartFor(boneName, shape)
        if (meshFilter && meshFilter.length > 0) part.meshFilter = meshFilter
        const inst = createPartMesh(scene, part, customModel, ed.models[0])
        customModel.creatorParts.set(part.id, inst)
        bumpCreatorParts()
        return part.id
      },

      // Add a prop clone (non-skinned mesh — sword, shield, etc.) by source
      // mesh name. Engine auto-resolves the attachment bone by walking the
      // source mesh's parent chain to find the nearest bone TransformNode.
      addCreatorPropClone: (sourceMeshName: string): string | null => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return null
        const customModel = ed.models[customIdx]
        const sourceModel = ed.models[0]
        // Find the source mesh
        const srcMesh = sourceModel.glbMeshes.find(
          (m: any) => m.name === sourceMeshName && m.getTotalVertices?.() > 0,
        )
        if (!srcMesh) {
          console.warn(`[creator] prop '${sourceMeshName}' not found on source model`)
          return null
        }
        // Walk parent chain to find a bone-linked TransformNode.
        const boneLinkedNodes = new Map<any, string>()
        for (const b of sourceModel.skeleton.bones) {
          if (b._linkedTransformNode) boneLinkedNodes.set(b._linkedTransformNode, b.name)
        }
        let cursor: any = srcMesh.parent
        let boneName: string | null = null
        while (cursor) {
          if (boneLinkedNodes.has(cursor)) {
            boneName = boneLinkedNodes.get(cursor)!
            break
          }
          cursor = cursor.parent
        }
        if (!boneName) {
          console.warn(`[creator] prop '${sourceMeshName}' has no bone ancestor`)
          return null
        }
        const part = defaultPartFor(boneName, 'clone' as CreatorShape)
        part.sourceMeshName = sourceMeshName
        const inst = createPartMesh(scene, part, customModel, sourceModel)
        customModel.creatorParts.set(part.id, inst)
        bumpCreatorParts()
        return part.id
      },

      // Enumerate available clone targets — all bones + non-skinned
      // renderable prop meshes + weapon-library items. Props are grouped
      // by name stem so a multi-primitive prop surfaces as one entry.
      // `weapons` items come from /public/models/weapons/ — separate
      // from Model 1's `props` so the UI can show them in their own
      // category.
      getCreatorTargets: (): {
        bones: string[]
        props: Array<{ stem: string; members: string[] }>
        weapons: Array<{ stem: string; members: string[]; kind: string }>
      } => {
        const sourceModel = ed.models[0]
        const bones = sourceModel.skeleton.bones.map((b) => b.name)
        // Collect all non-skinned, renderable, non-root meshes.
        const raw: string[] = []
        const seen = new Set<string>()
        for (const m of sourceModel.glbMeshes as any[]) {
          if (!m || m.skeleton) continue
          if (!m.getTotalVertices || m.getTotalVertices() === 0) continue
          if (m.name === '__root__' || m.name === 'Armature') continue
          if (seen.has(m.name)) continue
          seen.add(m.name)
          raw.push(m.name)
        }
        // Group by stem. Babylon's GLB loader names multi-material
        // primitives "<stem>_primitive<N>" — split on that. For meshes
        // without the suffix, the stem IS the name (single-primitive prop).
        const byStem = new Map<string, string[]>()
        for (const name of raw) {
          const m = name.match(/^(.*)_primitive\d+$/)
          const stem = m ? m[1] : name
          if (!byStem.has(stem)) byStem.set(stem, [])
          byStem.get(stem)!.push(name)
        }
        const props = Array.from(byStem.entries()).map(([stem, members]) => ({ stem, members }))
        // Weapon library — separate enumeration. Each entry already has a
        // resolved stem + member mesh list at scene-init time.
        const weapons = (ed.weaponLibrary ?? []).map((w) => ({
          stem: w.stem,
          members: w.meshes.map((m) => m.name),
          kind: w.kind,
        }))
        return { bones, props, weapons }
      },

      // Add a multi-primitive prop as ONE group part. All children share
      // the group root's transform — rotating/scaling moves them together.
      // Bone is auto-resolved from the first child's parent chain.
      addCreatorPropGroupClone: (stem: string, memberNames: string[]): string | null => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return null
        const customModel = ed.models[customIdx]
        const sourceModel = ed.models[0]
        if (memberNames.length === 0) return null
        // Resolve bone from first child (all members share a parent in
        // a well-formed GLB; if they don't, the first one anchors).
        const first = sourceModel.glbMeshes.find(
          (m: any) => m.name === memberNames[0] && m.getTotalVertices?.() > 0,
        )
        if (!first) return null
        const boneLinkedNodes = new Map<any, string>()
        for (const b of sourceModel.skeleton.bones) {
          if (b._linkedTransformNode) boneLinkedNodes.set(b._linkedTransformNode, b.name)
        }
        let cursor: any = first.parent
        let boneName: string | null = null
        while (cursor) {
          if (boneLinkedNodes.has(cursor)) {
            boneName = boneLinkedNodes.get(cursor)!
            break
          }
          cursor = cursor.parent
        }
        if (!boneName) {
          console.warn(`[creator] prop group '${stem}' has no bone ancestor`)
          return null
        }
        const part = defaultPartFor(boneName, 'clone' as CreatorShape)
        part.groupMeshNames = memberNames
        // Store the stem in sourceMeshName too so the UI can label it.
        part.sourceMeshName = stem
        const inst = createPartMesh(scene, part, customModel, sourceModel)
        customModel.creatorParts.set(part.id, inst)
        bumpCreatorParts()
        return part.id
      },

      // Add a weapon-library item as a Creator clone. Defaults attach
      // bone to Hand Hold.R (right hand) — user can re-target after add.
      // Treats every weapon as a "group" regardless of primitive count
      // so the stem (e.g. "copper_axe") shows in the part label rather
      // than the raw mesh name.
      addCreatorWeaponClone: (stem: string, memberNames: string[], targetBone?: string): string | null => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return null
        const customModel = ed.models[customIdx]
        const sourceModel = ed.models[0]
        const entry = ed.weaponLibrary?.find((w) => w.stem === stem)
        if (!entry) {
          console.warn(`[creator] weapon '${stem}' not found in library`)
          return null
        }
        // Default attach: right hand. Shields would default to Hand Hold.L
        // — that's a future weapon-kind-aware default.
        const bone = targetBone ?? 'Hand Hold.R'
        if (!customModel.skeleton.bones.find((b) => b.name === bone)) {
          console.warn(`[creator] weapon target bone '${bone}' missing on Custom`)
          return null
        }
        // Synthetic source — Model 1's bone-resolution machinery in
        // createPropGroupClonePart only reads glbMeshes for the child
        // lookup. Append the weapon meshes so the existing code path
        // finds them by name.
        const syntheticSource: any = {
          ...sourceModel,
          glbMeshes: [...sourceModel.glbMeshes, ...entry.meshes],
        }
        const part = defaultPartFor(bone, 'clone' as CreatorShape)
        part.sourceMeshName = stem
        part.groupMeshNames = memberNames
        const inst = createPartMesh(scene, part, customModel, syntheticSource)
        customModel.creatorParts.set(part.id, inst)
        bumpCreatorParts()
        return part.id
      },

      updateCreatorPart: (id: string, patch: Partial<CreatorPart>) => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return
        const customModel = ed.models[customIdx]
        const inst = customModel.creatorParts.get(id)
        if (!inst) return
        // Source needs weapon library meshes too so weapon clones can
        // rebuild (e.g. when user retargets the bone, the prop-group
        // path re-looks-up meshes by name).
        const sourceModel = ed.models[0]
        const weaponMeshes = (ed.weaponLibrary ?? []).flatMap((w) => w.meshes)
        const syntheticSource: any = {
          ...sourceModel,
          glbMeshes: [...sourceModel.glbMeshes, ...weaponMeshes],
        }
        const next = updatePartMesh(scene, inst, patch, customModel, syntheticSource)
        customModel.creatorParts.set(id, next)
        bumpCreatorParts()
      },

      deleteCreatorPart: (id: string) => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return
        const m = ed.models[customIdx]
        const inst = m.creatorParts.get(id)
        if (!inst) return
        disposePartMesh(inst)
        m.creatorParts.delete(id)
        bumpCreatorParts()
      },

      getCreatorParts: (): CreatorPart[] => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return []
        const m = ed.models[customIdx]
        return Array.from(m.creatorParts.values()).map((i) => ({ ...i.data }))
      },

      // Bulk replace — used by persistence hydrate on page load. Disposes
      // current parts then recreates from data. Source's glbMeshes are
      // augmented with the weapon library so persisted weapon clones
      // find their source mesh by name on rehydrate.
      setCreatorParts: (parts: CreatorPart[]) => {
        const customIdx = 2
        if (customIdx >= ed.models.length) return
        const customModel = ed.models[customIdx]
        const sourceModel = ed.models[0]
        const weaponMeshes = (ed.weaponLibrary ?? []).flatMap((w) => w.meshes)
        const syntheticSource: any = {
          ...sourceModel,
          glbMeshes: [...sourceModel.glbMeshes, ...weaponMeshes],
        }
        for (const inst of customModel.creatorParts.values()) disposePartMesh(inst)
        customModel.creatorParts.clear()
        for (const p of parts) {
          if (!customModel.skeleton.bones.find((b) => b.name === p.boneName)) continue
          const inst = createPartMesh(scene, p, customModel, syntheticSource)
          customModel.creatorParts.set(p.id, inst)
        }
        bumpCreatorParts()
      },
      // Subscribe to creator-parts mutations. Returns an unsubscribe fn.
      // Used by EditorPanel to trigger the debounced persistence save.
      addCreatorPartsListener: (fn: () => void) => {
        creatorPartsListeners.push(fn)
        return () => {
          const i = creatorPartsListeners.indexOf(fn)
          if (i >= 0) creatorPartsListeners.splice(i, 1)
        }
      },
      getCreatorPartsRevision: () => creatorPartsRev,
      getInitialAnchor: () => ({
        id: '__initial__',
        name: 'Initial position',
        rotations: { ...active().restPose },
        positions: { ...active().restPositions },
        system: true as const,
      }),
      // Legacy rest pose of the older knight rig — used ONCE by the
      // EditorPanel hydration to retarget saved anchors/poses authored
      // against the old asset to the v3 rig. Null if backup GLB is
      // missing (post-retarget cleanup).
      getLegacyRestPose: () => ed.legacyRestPose,
    }

    if (cameraMode === 'editor') {
      bonePicker.setActive(true)
    }
  })

  // Dev: expose scene/camera for headless QA + console tinkering
  ;(window as any).__bjs = { engine, scene, camera, fpCam, setCameraMode }

  onReady({ engine, scene })

  engine.runRenderLoop(() => {
    scene.render()
  })

  const onResize = () => engine.resize()
  window.addEventListener('resize', onResize)

  return () => {
    window.removeEventListener('resize', onResize)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    scene.dispose()
    engine.dispose()
  }
}

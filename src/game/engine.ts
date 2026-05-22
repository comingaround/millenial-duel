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
import { ACTIVE_BONES, createEditorScene } from '../editor/editor-scene'
import { createBonePicker } from '../editor/bone-picker'
import { createEditorGizmo } from '../editor/gizmo'
import { applyPose, snapshotPose, POSITION_BONES } from '../editor/pose-store'
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

  // --- Third camera: Editor. Orbits the standalone editor knight. ---
  const editorCam = new ArcRotateCamera(
    'editor_cam',
    Math.PI / 2,             // facing knight from his front (knight defaults facing -Z)
    Math.PI / 2.4,
    4,
    new Vector3(50, 1.0, 0),
    scene,
  )
  editorCam.fov = 0.9
  editorCam.minZ = 0.05
  editorCam.maxZ = 2000
  editorCam.lowerRadiusLimit = 1.5
  editorCam.upperRadiusLimit = 20
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
      | Array<{ heroKey?: string; oppKey?: string; resolved: any[] }>
      | undefined
    const key = e.key.toLowerCase()
    if (customAnims) {
      for (const ca of customAnims) {
        if (ca.heroKey && ca.heroKey === key) {
          (window as any).__hero?.playCustomAnimation?.(ca.resolved)
          return
        }
        if (ca.oppKey && ca.oppKey === key) {
          (window as any).__opponent?.playCustomAnimation?.(ca.resolved)
          return
        }
      }
    }
    if (e.key === 'u' || e.key === 'U')   (window as any).__opponent?.playSlash?.()
    if (e.key === 'Enter')                (window as any).__opponent?.playBlock?.()
    if (e.key === 'q' || e.key === 'Q')   (window as any).__hero?.playStrike?.()
    if (e.key === ' ')                  { e.preventDefault(); (window as any).__hero?.playBlock?.() }
  }
  const onKeyUp = (e: KeyboardEvent) => {
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
  createOpponent(scene)
  createHero(scene)

  // --- Editor: load standalone knight + wire bone picker + custom rotation API ---
  createEditorScene(scene).then((ed) => {
    if (!ed) return
    bonePicker = createBonePicker(scene, ed.skeleton, ACTIVE_BONES)
    editorGizmo = createEditorGizmo(scene, ed.skeleton)
    // Babylon's gizmo rings disabled — we use our own 3-sphere UI on the right.
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
      const bone = ed.skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return
      node.rotationQuaternion =
        node.rotationQuaternion ?? node.rotation.toQuaternion()
      const ax =
        axis === 'x' ? new Vector3(1, 0, 0)
        : axis === 'y' ? new Vector3(0, 1, 0)
        : new Vector3(0, 0, 1)
      const offset = Quaternion.RotationAxis(ax, deltaRad)
      // Post-multiply: rotation is in the bone's LOCAL frame
      node.rotationQuaternion = node.rotationQuaternion.multiply(offset)
    }

    // Translate the selected bone in WORLD space (X=screen-right, Y=up,
    // Z=screen-forward). Babylon stores node.position in parent-local space,
    // but the rig's parent-local axes are rotated by the Blender→Babylon
    // conversion, so editing position.xyz directly produces axis-mixing
    // (X mostly fine, Y becomes forward, Z becomes up + side). Using
    // node.translate(axis, dist, Space.WORLD) lets Babylon do the parent-
    // inverse-transform math, so the user's intent matches what they see.
    // Only valid for POSITION_BONES (Hips) — silently no-ops for others.
    const translateSelectedBone = (axis: 'x' | 'y' | 'z', delta: number) => {
      if (!currentSelection) return
      if (!POSITION_BONES.includes(currentSelection)) return
      const bone = ed.skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return
      const dir =
        axis === 'x' ? Vector3.Right()
        : axis === 'y' ? Vector3.Up()
        : Vector3.Forward()
      node.translate(dir, delta, Space.WORLD)
    }

    let activeAnimatables: Animatable[] = []
    const stopActiveAnimation = () => {
      if (activeAnimatables.length) {
        stopAnimation(activeAnimatables)
        activeAnimatables = []
      }
    }

    // --- Undo / Redo stacks (last N bone-rotation snapshots each) ---
    // pushUndo: snapshot current → undo, clear redo (new action invalidates
    //   any redoable forward history — standard editor behavior).
    // undo: snapshot current → redo, then pop undo and apply.
    // redo: snapshot current → undo, then pop redo and apply.
    const MAX_UNDO = 40
    type Snap = {
      rotations: Record<string, [number, number, number, number]>
      positions: Record<string, [number, number, number]>
    }
    const undoStack: Snap[] = []
    const redoStack: Snap[] = []
    const captureCurrent = (): Snap => {
      const s = snapshotPose(ed.skeleton, '__snap__')
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
      applyPose(ed.skeleton, prev)
      return true
    }
    const redo = () => {
      stopActiveAnimation()
      const next = redoStack.pop()
      if (!next) return false
      undoStack.push(captureCurrent())
      if (undoStack.length > MAX_UNDO) undoStack.shift()
      applyPose(ed.skeleton, next)
      return true
    }

    // Read selected bone rotation as Euler angles (degrees) — for the UI readout
    const getSelectedBoneEuler = () => {
      if (!currentSelection) return null
      const bone = ed.skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node || !node.rotationQuaternion) return null
      const e = node.rotationQuaternion.toEulerAngles()
      const R2D = 180 / Math.PI
      return { x: e.x * R2D, y: e.y * R2D, z: e.z * R2D }
    }

    // Read the selected bone's WORLD-space translation delta from its rest
    // world position (only meaningful for POSITION_BONES). World-space — not
    // local-parent — because that's what matches the user's screen-axis
    // intuition and what translateSelectedBone now operates in.
    const getSelectedBonePosition = () => {
      if (!currentSelection) return null
      if (!POSITION_BONES.includes(currentSelection)) return null
      const bone = ed.skeleton.bones.find((b) => b.name === currentSelection)
      const node = bone?._linkedTransformNode
      if (!node) return null
      const restWorld = ed.restWorldPositions[currentSelection]
      if (!restWorld) return null
      node.computeWorldMatrix(true)
      const wp = node.getAbsolutePosition()
      return {
        x: wp.x - restWorld[0],
        y: wp.y - restWorld[1],
        z: wp.z - restWorld[2],
      }
    }

    // Capture original editor material colors NOW, before any user edits.
    // This is the baseline for the Style panel's Reset button.
    const editorMaterialBaseline = new Map<string, string>()
    for (const m of scene.materials as any[]) {
      if (typeof m.name === 'string' && m.name.startsWith('editor_')) {
        editorMaterialBaseline.set(m.name, m.diffuseColor?.toHexString?.() ?? '#888888')
      }
    }

    ;(window as any).__editor = {
      snapshot: (name: string) => snapshotPose(ed.skeleton, name),
      apply: (pose: {
        rotations: Record<string, [number, number, number, number]>
        positions?: Record<string, [number, number, number]>
      }) => {
        stopActiveAnimation()
        applyPose(ed.skeleton, pose)
      },
      reset: () => {
        stopActiveAnimation()
        applyPose(ed.skeleton, {
          rotations: ed.restPose,
          positions: ed.restPositions,
        })
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
        activeAnimatables = playAnimation(scene, ed.skeleton, keyframes)
      },
      stopAnimation: () => stopActiveAnimation(),
      listBakedAnimations: () =>
        ed.animationGroups.map((g: any) => ({
          name: g.name,
          from: g.from,
          to: g.to,
        })),
      // Sample a baked anim at frames, returning anchors + their times.
      // `sampleCount === 0` → use the ORIGINAL keyframes the artist authored
      // (union of every targeted bone's keyframe times). Otherwise sample at
      // N evenly-spaced frames across the full range.
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
          // Use the union of all keyframe times from every targeted bone
          const set = new Set<number>()
          for (const ta of group.targetedAnimations) {
            const keys = ta.animation.getKeys()
            for (const k of keys) {
              if (k.frame >= fromFrame && k.frame <= toFrame) set.add(k.frame)
            }
          }
          frames = Array.from(set).sort((a, b) => a - b)
          if (frames.length < 2) {
            // Fallback if the anim only has a single key somewhere
            frames = [fromFrame, toFrame]
          }
        } else {
          for (let i = 0; i < sampleCount; i++) {
            const t = i / (sampleCount - 1)
            frames.push(Math.round(fromFrame + (toFrame - fromFrame) * t))
          }
        }
        // Start playing the group so goToFrame works, then pause + walk
        stopActiveAnimation()
        group.start(false, 1.0)
        group.pause()
        const anchors: {
          name: string
          rotations: Record<string, [number, number, number, number]>
        }[] = []
        const durations: number[] = []
        for (let i = 0; i < frames.length; i++) {
          group.goToFrame(frames[i])
          // Force skeleton matrices to refresh
          for (const s of ed.skeletons) s.prepare()
          const snap = snapshotPose(ed.skeleton, `${animName}_${i + 1}`)
          anchors.push({ name: snap.name, rotations: snap.rotations })
          durations.push((frames[i] - fromFrame) / fps)
        }
        group.stop()
        // Restore rest pose so the editor knight isn't stuck at the last
        // sample's bones
        applyPose(ed.skeleton, { rotations: ed.restPose })
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
      // Right-panel can flip the bone-picker spheres off when switching to
      // Style mode so the armor is visually clear.
      setBonePickerActive: (active: boolean) => {
        bonePicker?.setActive(active)
      },
      // Editor-knight materials — list + recolor for the Style panel. Materials
      // were created as `editor_${matName}` in editor-scene.ts.
      getEditorMaterials: () => {
        return scene.materials
          .filter((m: any) => typeof m.name === 'string' && m.name.startsWith('editor_'))
          .map((m: any) => ({
            name: m.name.replace(/^editor_/, ''),
            hex: m.diffuseColor?.toHexString?.() ?? '#888888',
          }))
      },
      setEditorMaterialColor: (matName: string, hex: string) => {
        const full = `editor_${matName}`
        const mat = scene.materials.find((m: any) => m.name === full) as any
        if (!mat) return
        const c = Color3.FromHexString(hex)
        mat.diffuseColor = c
        mat.ambientColor = c.scale(0.5)
      },
      // Restore every editor_* material to its scene-load color.
      resetEditorMaterials: () => {
        for (const m of scene.materials as any[]) {
          if (typeof m.name !== 'string' || !m.name.startsWith('editor_')) continue
          const hex = editorMaterialBaseline.get(m.name)
          if (!hex) continue
          const c = Color3.FromHexString(hex)
          m.diffuseColor = c
          m.ambientColor = c.scale(0.5)
        }
      },
      getInitialAnchor: () => ({
        id: '__initial__',
        name: 'Initial position',
        rotations: { ...ed.restPose },
        system: true as const,
      }),
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

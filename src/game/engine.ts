import {
  ArcRotateCamera,
  Color3,
  Color4,
  Engine,
  Scene,
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

  // Mode switch — keep arc cam active by default
  let cameraMode: 'free' | 'locked' = 'free'
  scene.activeCamera = camera

  const setCameraMode = (mode: 'free' | 'locked') => {
    cameraMode = mode
    if (mode === 'free') {
      scene.activeCamera = camera
      camera.attachControl(canvas, false)
      fpCam.detachControl()
    } else {
      scene.activeCamera = fpCam
      fpCam.attachControl(canvas, false)
      camera.detachControl()
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

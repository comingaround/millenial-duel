import '@babylonjs/loaders/glTF'
import {
  Animation,
  AnimationGroup,
  Color3,
  Mesh,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'

const POSITION = new Vector3(0, 0, -5)

const MAT_COLORS: Record<string, Color3> = {
  'Blade':            new Color3(0.78, 0.80, 0.86),
  'Blade highlight':  new Color3(0.94, 0.95, 0.98),
  'Wood':             new Color3(0.50, 0.32, 0.18),
  'Emblem':           new Color3(0.74, 0.15, 0.15),
  'Metal':            new Color3(0.62, 0.50, 0.22),
  'Metal Dark':       new Color3(0.18, 0.20, 0.24),
  'Metal_dark':       new Color3(0.32, 0.34, 0.40),
  'Metal.002':        new Color3(0.58, 0.62, 0.70),
  'Skin':             new Color3(0.94, 0.78, 0.66),
  'Hair':             new Color3(0.30, 0.20, 0.12),
  'Shirt':            new Color3(0.70, 0.66, 0.58),
  'Shoe':             new Color3(0.38, 0.28, 0.18),
  'Pants.001':        new Color3(0.40, 0.30, 0.20),
  'Underclothes.001': new Color3(0.42, 0.22, 0.20),
  'Black':            new Color3(0.20, 0.21, 0.24),
}
const FALLBACK = new Color3(0.55, 0.55, 0.55)

export type OpponentApi = {
  playSlash: () => void
  playBlock: () => void
}

export function createOpponent(scene: Scene): Promise<OpponentApi | null> {
  return SceneLoader.ImportMeshAsync('', '/models/', 'knight.glb', scene)
    .then((result) => {
      const root =
        result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]
      root.name = 'opponent'
      root.position = POSITION.clone()
      root.scaling = root.scaling.scale(1.2)
      root.rotation = new Vector3(0, 0, 0)

      // Materials
      const matCache = new Map<string, StandardMaterial>()
      for (const m of result.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
        if (!m.material) continue
        const matName = m.material.name
        let mat = matCache.get(matName)
        if (!mat) {
          mat = new StandardMaterial(`opp_${matName}`, scene)
          mat.diffuseColor = MAT_COLORS[matName] ?? FALLBACK
          mat.specularColor = new Color3(0.10, 0.10, 0.12)
          mat.ambientColor = (MAT_COLORS[matName] ?? FALLBACK).scale(0.5)
          matCache.set(matName, mat)
        }
        m.material = mat
      }

      // Animations + skeleton
      const skeleton = result.skeletons[0]
      const combatIdle = result.animationGroups.find((g) =>
        g.name.toLowerCase().includes('combat_idle'),
      )
      const slashAnim = result.animationGroups.find((g) =>
        g.name.toLowerCase().includes('sword_atk01'),
      )

      result.animationGroups.forEach((g) => g.stop())
      combatIdle?.start(true)

      // --- Block animation (coded, since the GLB doesn't ship one) ---
      // Rotate Upper Arm.L so the arm raises in front + up, bringing the
      // shield (held in Hand.L) toward the head. Forearm + hand follow as
      // children — no separate keyframes needed for them.
      const upperArmL = skeleton?.bones.find((b) => b.name === 'Upper Arm.L') ?? null
      let restQuatL: Quaternion | null = null
      if (upperArmL) {
        upperArmL.rotationQuaternion =
          upperArmL.rotationQuaternion ?? upperArmL.rotation.toQuaternion()
        restQuatL = upperArmL.rotationQuaternion.clone()
      }

      // Block = small shoulder rotation that lifts the elbow ~30cm while
      // keeping the shield nearly vertical (pure translation would stretch
      // the skinned arm; small rotation is the clean way).
      const upperArmLNode = upperArmL?._linkedTransformNode
        ?? scene.getTransformNodeByName('Upper Arm.L')
      const ensureQuat = (n: typeof upperArmLNode) => {
        if (!n) return null
        n.rotationQuaternion = n.rotationQuaternion ?? n.rotation.toQuaternion()
        return n.rotationQuaternion.clone()
      }
      const restUpperL = ensureQuat(upperArmLNode)

      let blockActive = false
      const playBlock = () => {
        if (!upperArmLNode || !restUpperL || blockActive) return
        blockActive = true
        combatIdle?.pause()

        // ~40° rotation around local X — small enough to barely tilt the
        // shield, big enough to lift elbow ~30cm at ~0.5m arm length.
        const offset = Quaternion.RotationAxis(new Vector3(1, 0, 0), Math.PI * 0.22)
        const blockQuat = restUpperL.multiply(offset)

        const anim = new Animation(
          'opp_block', 'rotationQuaternion', 30,
          Animation.ANIMATIONTYPE_QUATERNION,
          Animation.ANIMATIONLOOPMODE_CONSTANT,
        )
        anim.setKeys([
          { frame: 0,  value: restUpperL.clone() },
          { frame: 6,  value: blockQuat },
          { frame: 18, value: blockQuat },
          { frame: 26, value: restUpperL.clone() },
        ])
        scene.beginDirectAnimation(
          upperArmLNode, [anim], 0, 26, false, 1.0,
          () => {
            blockActive = false
            upperArmLNode.rotationQuaternion = restUpperL.clone()
            combatIdle?.play(true)
          },
        )
      }

      let slashActive = false
      const playSlash = () => {
        if (!slashAnim || slashActive) return
        slashActive = true
        // Pause idle while slash plays so it doesn't fight for the bones
        combatIdle?.pause()
        slashAnim.stop()
        slashAnim.onAnimationGroupEndObservable.addOnce(() => {
          slashActive = false
          combatIdle?.play(true)
        })
        slashAnim.start(false, 1.0)
      }

      console.log(
        `[opponent] knight loaded — ${result.meshes.length} meshes, ` +
          `${result.skeletons.length} skeletons, ` +
          `${result.animationGroups.length} animations. ` +
          `Slash:${slashAnim ? 'yes' : 'NO'} Idle:${combatIdle ? 'yes' : 'NO'} ` +
          `UpperArmL:${upperArmL ? 'yes' : 'NO'}`,
      )

      const api: OpponentApi = { playSlash, playBlock }
      ;(window as any).__opponent = api
      return api
    })
    .catch((err) => {
      console.error('[opponent] knight load failed', err)
      return null
    })
}

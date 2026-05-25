import '@babylonjs/loaders/glTF'
import {
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core'
import { playAnimation, AnimationKeyframe } from '../../editor/animation-player'
import { applyPose } from '../../editor/pose-store'

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
  // Empty for now — combat actions are user-authored animations bound to
  // keys via the editor's animation row.
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

      console.log(
        `[opponent] knight loaded — ${result.meshes.length} meshes`,
      )

      const playCustomAnimation = (
        keyframes: AnimationKeyframe[],
        initialPose?: {
          rotations: Record<string, [number, number, number, number]>
          positions?: Record<string, [number, number, number]>
        },
      ) => {
        combatIdle?.pause()
        if (initialPose) applyPose(skeleton, initialPose)
        playAnimation(scene, skeleton, keyframes, root)
        const lastTime = keyframes[keyframes.length - 1]?.time ?? 0
        setTimeout(() => combatIdle?.play(true), Math.max(50, lastTime * 1000 + 200))
      }

      const api: OpponentApi & {
        playCustomAnimation: (
          kfs: AnimationKeyframe[],
          initialPose?: {
            rotations: Record<string, [number, number, number, number]>
            positions?: Record<string, [number, number, number]>
          },
        ) => void
      } = { playCustomAnimation }
      ;(window as any).__opponent = api
      return api
    })
    .catch((err) => {
      console.error('[opponent] knight load failed', err)
      return null
    })
}

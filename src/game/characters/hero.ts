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

// Hero stands 3m behind the camera-default-stance. Faces +Z toward opponent.
const POSITION = new Vector3(0, 0, -8)

// Same palette as opponent (could differentiate by tinting later if you
// want to distinguish hero from opponent).
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

// Hide only the head — body/arms/chest stay visible in 3rd-person.
// In Locked camera mode the camera sits at the head bone position, so the
// surrounding body geometry is naturally behind/below the camera frame.
const HIDDEN_MESHES = new Set(['Helmet', 'Hair'])

import type { TransformNode } from '@babylonjs/core'

export type HeroApi = {
  getHeadNode: () => TransformNode | null
}

export function createHero(scene: Scene): Promise<HeroApi | null> {
  return SceneLoader.ImportMeshAsync('', '/models/', 'knight.glb', scene)
    .then((result) => {
      const root =
        result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]
      root.name = 'hero'
      root.position = POSITION.clone()
      root.scaling = root.scaling.scale(1.2)
      root.rotation = new Vector3(0, Math.PI, 0)   // face opponent (+Z)

      // Materials
      const matCache = new Map<string, StandardMaterial>()
      for (const m of result.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
        if (!m.material) continue
        const matName = m.material.name
        let mat = matCache.get(matName)
        if (!mat) {
          mat = new StandardMaterial(`hero_${matName}`, scene)
          mat.diffuseColor = MAT_COLORS[matName] ?? FALLBACK
          mat.specularColor = new Color3(0.10, 0.10, 0.12)
          mat.ambientColor = (MAT_COLORS[matName] ?? FALLBACK).scale(0.5)
          matCache.set(matName, mat)
        }
        m.material = mat
      }

      // Hide head-region meshes for first-person view. Match by PREFIX
      // because multi-material meshes get `_primitiveN` suffixes (e.g.
      // `Helmet_primitive0`, `Platebody_primitive3`).
      for (const m of result.meshes) {
        if (!(m instanceof Mesh)) continue
        const stem = m.name.split('_primitive')[0]
        if (HIDDEN_MESHES.has(stem)) m.isVisible = false
      }

      // Skeleton + baked animations (from THIS load — not scene-global)
      const skeleton = result.skeletons[0]
      const combatIdle = result.animationGroups.find((g) =>
        g.name.toLowerCase().includes('combat_idle'),
      )
      const slashAnim = result.animationGroups.find((g) =>
        g.name.toLowerCase().includes('sword_atk01'),
      )
      result.animationGroups.forEach((g) => g.stop())
      combatIdle?.start(true)

      // Head bone (for the Locked camera mode to pin to)
      const headBone = skeleton?.bones.find((b) => b.name === 'Head')
      const headNode = headBone?._linkedTransformNode ?? null

      console.log(
        `[hero] knight loaded — ${result.meshes.length} meshes`,
      )

      const playCustomAnimation = (keyframes: AnimationKeyframe[]) => {
        combatIdle?.pause()
        // Pass root so per-keyframe displacement physically moves the hero.
        playAnimation(scene, skeleton, keyframes, root)
        const lastTime = keyframes[keyframes.length - 1]?.time ?? 0
        setTimeout(() => combatIdle?.play(true), Math.max(50, lastTime * 1000 + 200))
      }

      const api: HeroApi & {
        playCustomAnimation: (kfs: AnimationKeyframe[]) => void
      } = {
        getHeadNode: () => headNode,
        playCustomAnimation,
      }
      ;(window as any).__hero = api
      return api
    })
    .catch((err) => {
      console.error('[hero] load failed', err)
      return null
    })
}

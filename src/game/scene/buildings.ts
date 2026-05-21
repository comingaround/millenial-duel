import '@babylonjs/loaders/glTF'
import {
  Color3,
  Mesh,
  Scene,
  SceneLoader,
  StandardMaterial,
  Texture,
  Vector3,
} from '@babylonjs/core'

type TextureSpec = {
  diffuse?: string
  normal?: string
}

const PALETTE: Record<string, Color3> = {
  darkwood:             new Color3(0.28, 0.19, 0.13),
  wood:                 new Color3(0.55, 0.40, 0.25),
  rocks:                new Color3(0.58, 0.56, 0.52),
  rooftiles:            new Color3(0.48, 0.26, 0.20),
  dark_logwood_pattern: new Color3(0.28, 0.19, 0.13),
  pattern_logwood:      new Color3(0.52, 0.36, 0.22),
  lambert1:             new Color3(0.78, 0.74, 0.66),
  redwood:              new Color3(0.50, 0.22, 0.15),
  metal:                new Color3(0.35, 0.36, 0.38),
}

const FALLBACK_COLOR = new Color3(0.55, 0.55, 0.55)

type BuildingSpec = {
  file: string
  position: Vector3
  scale: number
  textures?: Record<string, TextureSpec>
}

const BUILDINGS: BuildingSpec[] = [
  {
    file: 'house.glb',
    position: new Vector3(-26, 0, 5),
    scale: 0.5,
  },
  {
    file: 'house-02.glb',
    position: new Vector3(-14, 0, 5),
    scale: 0.5,
  },
  {
    file: 'house-big.glb',
    position: new Vector3(4, 0, 24),
    scale: 0.25,
  },
  // Church removed from active render (kept in public/models/house-church.glb
  // for future use). It looked off — likely needs the FBX rig fixed in source
  // or a different church model entirely.
  {
    file: 'house-dog.glb',
    position: new Vector3(20, 0, 0),
    scale: 0.033,
  },
]

function loadBuilding(
  scene: Scene,
  spec: BuildingSpec,
  matCache: Map<string, StandardMaterial>,
) {
  return SceneLoader.ImportMeshAsync('', '/models/', spec.file, scene)
    .then((result) => {
      const root =
        result.meshes.find((m) => m.name === '__root__') ?? result.meshes[0]

      root.position = spec.position.clone()
      root.scaling = new Vector3(spec.scale, spec.scale, spec.scale)

      // Force-update child bbox after scale so getHierarchyBoundingVectors is correct
      root.computeWorldMatrix(true)
      for (const m of result.meshes) {
        if (m instanceof Mesh) m.refreshBoundingInfo()
      }

      const matForName = (materialName: string) => {
        const cacheKey = `${spec.file}::${materialName}`
        let mat = matCache.get(cacheKey)
        if (mat) return mat
        mat = new StandardMaterial(`bld_${cacheKey}`, scene)
        mat.specularColor = new Color3(0.05, 0.05, 0.05)
        const texSpec = spec.textures?.[materialName]
        if (texSpec?.diffuse) {
          mat.diffuseTexture = new Texture(texSpec.diffuse, scene)
          mat.diffuseColor = new Color3(1, 1, 1)
        } else {
          mat.diffuseColor = PALETTE[materialName] ?? FALLBACK_COLOR
        }
        if (texSpec?.normal) {
          mat.bumpTexture = new Texture(texSpec.normal, scene)
          mat.invertNormalMapX = true   // FBX exports use OpenGL-style normals
          mat.invertNormalMapY = true
        }
        matCache.set(cacheKey, mat)
        return mat
      }

      for (const m of result.meshes) {
        if (!(m instanceof Mesh) || m.getTotalVertices() === 0) continue
        if (m.material) m.material = matForName(m.material.name)
      }

      // Compute actual world bbox of the hierarchy (post-scale) and shift the
      // root up so the bottom sits exactly on the ground (y = 0).
      root.computeWorldMatrix(true)
      const bounds = root.getHierarchyBoundingVectors(true)
      const groundOffset = -bounds.min.y
      root.position.y += groundOffset

      console.log(
        `[buildings] ${spec.file} loaded (${result.meshes.length} meshes, bottom shifted ${groundOffset.toFixed(2)})`,
      )
    })
    .catch((err) => {
      console.error(`[buildings] ${spec.file} failed`, err)
    })
}

export function createBuildings(scene: Scene) {
  const matCache = new Map<string, StandardMaterial>()
  BUILDINGS.forEach((spec) => loadBuilding(scene, spec, matCache))
}

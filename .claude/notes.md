# Duel Game — Project Notes

First-person sword-and-shield duel game (KCD-style). Web first, mobile later via Capacitor. Currently a working scene with hero (FP) + opponent (3rd-person target) and the first two combat animations (sword strike + shield block) on both characters.

## Stack

- **Engine:** Babylon.js v7 (`@babylonjs/core` + `@babylonjs/loaders`)
- **UI:** React 18 — currently just camera-toggle overlay
- **Build:** Vite 5 + TypeScript 5
- **Asset pipeline:** FBX → GLB via `fbx2gltf` (installed at `/tmp/node_modules/fbx2gltf/bin/Linux/FBX2glTF` — node package `fbx2gltf` v0.9.7p1)
- **Mobile path (deferred):** Capacitor will wrap the production web build

`package.json` scripts:
```json
{ "dev": "vite --host", "build": "tsc && vite build", "preview": "vite preview" }
```
`--host` + `server.host: true` in `vite.config.ts` so the dev server binds to `0.0.0.0` and reachable on LAN. Server runs at `http://192.168.1.76:5173/` for the user.

## Current project layout

```
duel-game/
├── .claude/notes.md                     (this file)
├── public/
│   ├── models/                          (GLBs, served as /models/*)
│   │   ├── knight.glb                   reused for hero + opponent
│   │   ├── trees.glb                    8 low-poly trees (rendered as 1 unit)
│   │   ├── house.glb, house-02.glb,
│   │   ├── house-big.glb, house-dog.glb
│   │   └── house-church.glb             converted, NOT rendered (looked off)
│   └── textures/church/                 BaseColor + Normal (kept for church)
├── src/
│   ├── main.tsx                         no StrictMode
│   ├── App.tsx                          <Game /> + <CameraToggle />
│   ├── App.css                          viewport reset
│   ├── game/
│   │   ├── Game.tsx                     canvas wrapper
│   │   ├── engine.ts                    Engine, Scene, two cameras, key handlers
│   │   ├── lighting.ts                  hemi + directional sun
│   │   ├── sky.ts                       sphere skybox (vertical gradient) + sun mesh
│   │   ├── clouds.ts                    billboard cloud puffs scattered above scene
│   │   ├── scene/
│   │   │   ├── ground.ts                hand-painted DynamicTexture grass, 4000×4000
│   │   │   ├── trees.ts                 loads trees.glb, places + colors
│   │   │   └── buildings.ts             loads all house GLBs, auto-grounds via bbox
│   │   └── characters/
│   │       ├── opponent.ts              loads knight.glb, exposes playSlash/playBlock
│   │       └── hero.ts                  loads knight.glb again, head hidden for FP
│   └── ui/
│       └── CameraToggle.tsx             bottom-right Free Roam / Locked toggle
└── (vite, tsconfig, package.json, etc.)
```

## Scene state

- **Sky:** sphere with painted gradient (deep blue zenith → pale yellow-white horizon), sun is a separate emissive mesh, ~10 billboard cloud puffs scattered at altitude
- **Ground:** 4000×4000 plane, hand-painted grass texture (DynamicTexture: dense green flecks + dirt specks). No fog (would desaturate grass at distance).
- **Buildings:** town house, small hut, viking forge (bigger), dog house (~1m tall). Each one auto-grounds via `getHierarchyBoundingVectors`. Church kept on disk but not loaded.
- **Trees:** 8 low-poly trees from a single GLB, positioned via root rotation π/2 so they spread across X instead of clustering along Z.
- **Hero:** Knight at `(0, 0, -8)`, rotation π (facing +Z toward opponent). Helmet + Hair hidden so in Locked camera mode the head doesn't surround the camera.
- **Opponent:** Knight at `(0, 0, -5)`, rotation 0 (faces -Z toward hero). Full armor visible. Combat_idle anim loops.

Both characters share `knight.glb` — same skeleton (35 bones, Blender-named), same materials. Materials get cleaner solid colors than the embedded PBR ones (we override every material from the GLB).

## Cameras + controls

Two cameras switchable via the UI button bottom-right:

| Mode | Camera | Behaviour |
|---|---|---|
| **Free Roam** (default) | `ArcRotateCamera` | Orbits a target. Default target = opponent's head, radius 3m. Left-drag orbits, right-drag pans target, wheel zooms. Arrow keys translate the target (forward = camera's forward flattened to XZ). |
| **Locked (FPS)** | `UniversalCamera` | Position is snapped to the hero's Head bone each frame via `scene.onBeforeRenderObservable`. Mouse-drag rotates the look direction. No keyboard movement. |

Toggle implementation: `window.__bjs.setCameraMode('free' | 'locked')` — UI calls this. Each call swaps `scene.activeCamera` and attaches/detaches controls.

Arrow keys have `preventDefault` so the browser doesn't scroll while the camera moves. WASD was disabled — user prefers arrows only.

### Combat key bindings (current)

| Key | Action |
|---|---|
| `Q` | Hero sword strike (baked `Sword_atk01` anim) |
| `Space` | Hero shield block (coded animation) |
| `U` | Opponent sword strike (baked `Sword_atk01`) |
| `Enter` | Opponent shield block (coded animation) |

Each key handler calls `window.__hero?.playStrike?.()` etc. The character APIs are exposed via window: `window.__hero` and `window.__opponent`, each with `{playStrike, playBlock, ...}`.

## Animation system

We use BOTH baked GLB animations (for the slash) AND code-driven keyframe animations on individual bones (for the block).

**Knight GLB ships 8 animations:** `Idle`, `Combat_idle` (currently looped as the default stance), `Walk`, `Run`, `Punch`, `Grip left`, `Grip right`, **`Sword_atk01`** (used as the slash).

**Coded block** = rotate the `Upper Arm.L` bone (via its `_linkedTransformNode`) around its local X axis by ~40° (`Math.PI * 0.22`). Keyframes: rest → raised (frame 6) → hold (frame 18) → rest (frame 26) at 30fps. Forearm + hand + shield ride along as children.

**Conflict pattern:** the looping Combat_idle animation also animates the same bones we're trying to override. Solution: `combatIdle.pause()` before playing our custom animation, `combatIdle.play(true)` in the onAnimationEnd callback.

### Bone access gotcha

```ts
// WRONG — animating a Bone object directly often gets overwritten by the
// skeleton matrix update each frame
const bone = skeleton.bones.find(b => b.name === 'Upper Arm.L')
scene.beginDirectAnimation(bone, ...)   // ❌ may not visually update

// CORRECT — animate the linked TransformNode
const node = bone._linkedTransformNode
scene.beginDirectAnimation(node, ...)   // ✓
```

We hit this debugging the block — Combat_idle was overwriting the bone, AND I was animating the wrong object. Fix is two-step: pause Combat_idle + animate the linked node.

### Mesh visibility gotcha

When a glTF mesh has multiple primitives (multiple materials), Babylon's loader names them `<MeshName>_primitive0`, `_primitive1`, etc. So `Helmet` becomes `Helmet_primitive0` and `Helmet_primitive1`. **Match by prefix when filtering for visibility:**

```ts
const stem = m.name.split('_primitive')[0]
if (HIDDEN_MESHES.has(stem)) m.isVisible = false
```

This bit us when hiding the hero's head — exact-name match failed because Helmet/Platebody have multi-material primitives.

### Naming-conflict gotcha

Both hero and opponent load the SAME knight.glb. Babylon doesn't auto-rename duplicates — `scene.getTransformNodeByName('Head')` returns whichever it finds first.

When wiring per-character bones, navigate via the per-load `result.skeletons[0]`:
```ts
const heroHead = heroResult.skeletons[0].bones
  .find(b => b.name === 'Head')?._linkedTransformNode
```

Same for animations — use `result.animationGroups`, not `scene.animationGroups`.

## React + Babylon patterns

### No StrictMode
`main.tsx` is unwrapped — StrictMode double-mounts in dev, which makes Babylon's `useEffect`-based engine init fire twice. **Do not** wrap App in `<React.StrictMode>`.

### Stable onSceneReady callback
The current `Game.tsx` uses `useCallback`-wrapped handler so the engine doesn't reinit on every render. Watch for "[BJS] init" appearing more than once in the console — that's the smoke-test for accidental reinit.

### Window globals as a low-friction bridge
- `window.__bjs` = `{engine, scene, camera, fpCam, setCameraMode}`
- `window.__opponent` = `{playSlash, playBlock}`
- `window.__hero` = `{playStrike, playBlock, getHeadNode}`

The React side just calls these. Avoids prop drilling and lets the headless Playwright QA also poke at the scene. Could be replaced with React context later when there's more UI to manage.

## Asset pipeline (FBX → GLB)

All character/building/tree models came as FBX or OBJ from CGTrader. We convert to GLB at scaffold time:

```bash
/tmp/node_modules/fbx2gltf/bin/Linux/FBX2glTF --binary \
  -i <input.fbx> -o <public/models/output>
```

The tool warns about missing textures but the geometry comes through fine. For PBR-textured assets (church), we copied the BaseColor + Normal PNGs into `public/textures/<asset>/` and wired them via the materials object in the loader.

For non-PBR-textured assets (knight, gladiator), we override every material with `StandardMaterial` using hand-picked colors per material name. The embedded "textures" in some FBX-exported GLBs are UV-grid debug textures that look like colored noise — replace them.

## Testing / QA via Playwright

Playwright is at `/mnt/c/Users/aleks/Desktop/cannaid/node_modules/playwright/index.mjs` (shared from another project). QA pattern:

```js
import { chromium } from '/mnt/c/Users/aleks/Desktop/cannaid/node_modules/playwright/index.mjs'
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
})
// ... goto http://192.168.1.76:5173/
// ... await page.waitForTimeout(4500) to let GLBs load
// ... page.evaluate(() => window.__hero?.playStrike?.())
// ... page.screenshot({path: ...})
```

Headless screenshots take ~5-7 seconds. Don't use them for timing-sensitive animation tests — use `page.evaluate(() => scene.x)` to read state directly.

## Combat mechanics design (NOT YET IMPLEMENTED)

Designed but no React state machine yet. Plan:

| Param | Value |
|---|---|
| MAX_HP | 100 |
| HIT_DAMAGE | 10 |
| STRIKE_IMPACT_MS | 450 (delay before damage applies; matches mid-strike frame) |
| ACTION_LOCKOUT_MS | 1100 (no new actions during this) |
| AI_FIRST_DELAY_MS | 1000 |
| AI_MIN_INTERVAL_MS | 1500 |
| AI_MAX_INTERVAL_MS | 3000 |

Strike → damage flow:
1. Key press → fire animation + set `busy=true`
2. Schedule damage at `+STRIKE_IMPACT_MS`
3. Schedule `busy=false` at `+ACTION_LOCKOUT_MS`

Block window:
- When opponent strikes, set `incomingAttack` ('left' | 'right')
- If player presses block while `incomingAttack` set → cancel damage timer, cancel opp lockout, reset opp anim
- HUD will show green corner pulse during the window

NPC AI (placeholder):
- `setTimeout` chain in a `useEffect`
- Each tick: 50/50 left/right strike, then reschedule 1500-3000ms

Combat state will live in React (App.tsx will own `playerHP`, `opponentHP`, `incomingAttack`, `playerDead`, etc.). Use **refs for state read inside setTimeouts** — closures capture stale values.

## What's working / what's pending

✅ **Working:**
- Scene with sky, sun, clouds, grass, trees, buildings
- Hero + opponent both rendered with the same knight model
- Hero in FP view (head hidden, body visible from 3rd-person)
- Two cameras + UI toggle
- Q/Space (hero) and U/Enter (opponent) → strike + block animations
- Combat_idle looping on both, pauses cleanly when other animations play
- Arrow-key camera movement (no page scroll)

⏳ **Pending:**
- HP system + damage timing
- Block-window mechanic (cancel damage if blocked in time)
- Additional strikes (left/right) — only one slash exists, would need to mirror or hand-author
- Dodges (left/right) — would need procedural animations
- Hit-react / block-react / death animations
- NPC AI for opponent
- HUD: HP bars, key hints, attack-warning corners
- Mouse-look for hero in Locked camera (currently click-drag)

## What we tried and rejected

1. **Lego/voxel procedural humanoid** — initial plan from prior session. Abandoned because:
   - User wanted a more polished look that matched the buildings + trees
   - Found a free CGTrader low-poly knight (with rig + animations) that fits the aesthetic perfectly
2. **Gladiator GLB** — looked stylistically right but: no skeleton, 14 "animations" were actually node-transform clips, no sword/shield meshes in the GLB despite the listing title
3. **Viking GLB** — properly rigged (108-bone skeleton) but mid-poly realistic style clashed with low-poly scene. Also had odd UV stretching on some textures.
4. **Church (`house-church.glb`)** — converts and renders, but the model proportions look off and dome was awkward. Kept the GLB + textures on disk for possible later use. Not loaded in `buildings.ts`.
5. **WASD camera** — user found it confusing alongside the orbit camera. Removed; only arrows now.
6. **Hiding hero's whole upper body (Body + Platebody + Shirt)** — too aggressive, looked like floating sword/shield. User preferred only head hidden (Helmet + Hair), body visible.

## User communication preferences (from this session)

- **Visual changes:** show a screenshot after every code change. User iterates fast on visuals.
- **Vague descriptions are expected** — when user says "rotate the sword 90deg", clarify the axis and try one, but expect a couple of rounds. They've offered to take over the animation tinkering themselves since 3D rotation is hard to describe in text.
- **Color/texture descriptions** — user is okay with stylized solid colors as long as the proportions look right. The grass/trees/buildings established a "low-poly stylized" baseline; matching that is what counts.
- **Use Playwright proactively** — user said "use playwright to access web and QA yourself, so after each coding, QA what you did and then confirm". Don't submit code without a screenshot verification.

## File-specific notes

### `src/game/engine.ts`
Owns: Engine init, Scene, both cameras, all input handlers, scene env setup, the `setCameraMode` function. Exposed via `window.__bjs`. Returns a cleanup function from `createEngine` that disposes everything on unmount.

### `src/game/characters/opponent.ts` + `hero.ts`
Mirror structure. Each:
1. Loads `knight.glb` independently
2. Sets position + scale (`root.scaling.scale(1.2)` — never overwrite, always multiply, to preserve the GLB's internal -1 z-scale from fbx2gltf)
3. Overrides every material with `StandardMaterial` + a color from `MAT_COLORS`
4. Hides specific meshes (hero only — Helmet + Hair via prefix match)
5. Finds `Combat_idle` + `Sword_atk01` AnimationGroups in `result.animationGroups`
6. Locates the `Upper Arm.L` bone via `result.skeletons[0]`, grabs its linked transform node
7. Exposes `playStrike` + `playBlock` (+ `getHeadNode` for hero) via window globals

Both characters use the same color palette currently. Differentiating them visually (e.g. red shield emblem for opponent, blue for hero) is a one-liner — change `MAT_COLORS['Emblem']` in `hero.ts`.

### `src/ui/CameraToggle.tsx`
Position fixed bottom-right, calls `window.__bjs.setCameraMode(...)` on click. React state tracks current mode for the label.

### `src/game/scene/buildings.ts`
Loads multiple GLBs, each with a `BuildingSpec` (position, scale, optional texture overrides). After load, calls `getHierarchyBoundingVectors` and shifts root up by `-bounds.min.y` so the building bottom sits at world y=0. Replaced earlier manual `sourceMinY` guesswork.

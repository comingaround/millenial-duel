# Duel Game — Project Notes

First-person sword-and-shield duel game (KCD-style). Web first, mobile later via Capacitor. Currently a working scene with hero (FP) + opponent (3rd-person target) and the first two combat animations (sword strike + shield block) on both characters. **Custom in-browser pose/animation editor is now operational** — used to author new attack/block animations bound to per-character keys, persisted to a JSON library.

## ⚠️ Read this first (state after compaction)

- ✅ Duel scene (hero + opponent + 2 baked-key animations) — same as before
- ✅ Custom **pose/animation editor** at scene `(50, 0, 0)` — separate knight rig used purely as a posing puppet
- ✅ Editor features: bone-pick (sphere click), 3-axis knob rotation, **Hips Y stepper (CROUCH only — X/Z removed since locomotion moved to per-keyframe displacement)**, editable typed input + scroll-wheel + ± buttons, save Pose / Save Anchor, build Animation from anchor sequence with time offsets, Initial Position anchor (auto, undeletable), rename poses/anchors via ✎ icon, **Edit animation = ✎ opens full builder preloaded for in-place tinker**, import baked Knight GLB animations as anchor+animation pairs, per-animation hero/opponent key bindings
- ✅ **Locomotion = per-keyframe displacement** (NOT per-anim metadata, NOT Hips-X/Z promotion — both tried and rejected). Each keyframe in the animation builder has `pos X[ ] Y[ ] Z[ ]` cm inputs = where the body is at this keyframe relative to anim-start position. At playback, character's `root.position` is animated to those positions, transformed through root's rotation (so +Z = "character's forward"). Composes across anims: anim 2 starts from wherever anim 1 ended.
- ✅ **Editor preview moves the editor knight** through the world (not just bones-in-place) so author sees the actual character motion. Reset snaps editor knight back to its starting world position.
- ✅ **Always-visible BODY POSITION readout** in right panel (top, both Bones/Style modes) — live world-space cm coords relative to starting position. Updates every frame.
- ✅ **Style tab** (right panel toggle) — material recolor with native color pickers per material slot (Blade, Wood, Emblem, Metal, etc.). Editor knight only. Reset to default colors button. Bone spheres hidden in Style mode.
- ✅ **Undo + Redo** with keyboard shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z). UI: undo+redo in one row, full-width red Reset button below.
- ✅ Persistence: `public/custom-animations/library.json` via dev-only Vite middleware (`vite-plugins/animation-saver.ts`). Anchors carry `rotations` + (Hips-only) `positions`; animation keyframes carry `displacement` — all round-trip through the JSON automatically.
- ✅ Key dispatch: engine.ts checks `window.__customAnims` first → falls back to default Q/U/Space/Enter. Ctrl+Z/Y guarded before custom-anim lookup so a user-bound 'z'/'y' doesn't swallow them. Camera-mode `<select>` blurs after change so type-ahead ('e'→Editor) doesn't swallow keys.
- ✅ Hide hair on hero + opponent (prefix-match on mesh stem). Backface culling disabled on knight materials so mirrored geometry (right shoe, chestplate back) renders.
- ⏳ No HP / damage / AI / HUD yet. WASD free-roam not wired (next session).

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
│   │   ├── knight.glb                   reused for hero + opponent + editor puppet
│   │   ├── trees.glb                    8 low-poly trees (rendered as 1 unit)
│   │   ├── house.glb, house-02.glb,
│   │   ├── house-big.glb, house-dog.glb
│   │   └── house-church.glb             converted, NOT rendered (looked off)
│   ├── textures/church/                 BaseColor + Normal (kept for church)
│   └── custom-animations/
│       └── library.json                 persisted poses + anchors + animations
├── vite-plugins/
│   └── animation-saver.ts               dev-only middleware: GET/POST /api/animations
├── src/
│   ├── main.tsx                         no StrictMode
│   ├── App.tsx                          <Game /> + <CameraToggle /> + <EditorPanel />
│   ├── App.css                          viewport reset
│   ├── game/
│   │   ├── Game.tsx                     canvas wrapper
│   │   ├── engine.ts                    Engine, Scene, three cameras, key handlers, editor wiring
│   │   ├── lighting.ts                  hemi + directional sun
│   │   ├── sky.ts                       sphere skybox (vertical gradient) + sun mesh
│   │   ├── clouds.ts                    billboard cloud puffs scattered above scene
│   │   ├── scene/
│   │   │   ├── ground.ts                hand-painted DynamicTexture grass, 4000×4000
│   │   │   ├── trees.ts                 loads trees.glb, places + colors
│   │   │   └── buildings.ts             loads all house GLBs, auto-grounds via bbox
│   │   └── characters/
│   │       ├── opponent.ts              loads knight.glb, exposes playSlash/playBlock + playCustomAnimation
│   │       └── hero.ts                  loads knight.glb again, head hidden for FP, exposes playCustomAnimation
│   ├── editor/                          ← in-browser pose/animation editor
│   │   ├── editor-scene.ts              loads editor knight at (50,0,0), exports ACTIVE_BONES (19)
│   │   ├── bone-picker.ts               yellow spheres at active bones, click-to-select (no drag)
│   │   ├── pose-store.ts                snapshotPose / applyPose helpers
│   │   ├── animation-player.ts          builds Babylon Animations from anchor keyframes
│   │   ├── BoneControls.tsx             right panel: bone tree + 3 rotation knobs
│   │   ├── EditorPanel.tsx              left dashboard: poses/anchors/animations + import modal
│   │   └── gizmo.ts                     (legacy GizmoManager wiring, unused after drag removal)
│   └── ui/
│       └── CameraToggle.tsx             bottom-right Free Roam / Locked / Editor toggle
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

Three cameras switchable via the UI button bottom-right:

| Mode | Camera | Behaviour |
|---|---|---|
| **Free Roam** (default) | `ArcRotateCamera` | Orbits a target. Default target = opponent's head, radius 3m. Left-drag orbits, right-drag pans target, wheel zooms. Arrow keys translate the target (forward = camera's forward flattened to XZ). |
| **Locked (FPS)** | `UniversalCamera` | Position is snapped to the hero's Head bone each frame via `scene.onBeforeRenderObservable`. Mouse-drag rotates the look direction. No keyboard movement. |
| **Editor** | `ArcRotateCamera` | Frames the editor knight at world `(50, 0, 0)`. Opens left + right editor panels overlaid on the canvas. |

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

## Pose / Animation Editor

A complete in-browser animation authoring tool. Use the camera toggle to switch to **Editor** mode — the ArcRotateCamera frames a separate knight puppet at world `(50, 0, 0)`, a left-side dashboard appears for poses/anchors/animations, and a right-side panel for bone selection + rotation knobs.

### Concepts

| Term | What it is | Persisted? |
|---|---|---|
| **Pose** | A static snapshot of all bone rotations. For reference / starting points. | ✅ |
| **Anchor** | An animation **keyframe**. Same data structure as a Pose, but used as a building block of animations. | ✅ |
| **Initial Position** anchor | Auto-added, undeletable. Rendered as a virtual first entry — NOT stored in state, computed at render via `displayedAnchors = [initialAnchor, ...anchors]`. | Virtual |
| **Animation** | An ordered list of `{anchor, time}` keyframes. Playback uses Babylon Animations + slerp. | ✅ |

All persisted as JSON at `public/custom-animations/library.json`. Auto-save: 500ms debounced POST to `/api/animations` whenever poses/anchors/animations change. Auto-load: GET on mount.

### Bone subset (`ACTIVE_BONES` in `editor-scene.ts`)

19 combat-relevant bones only (out of 35 total in the rig):
- **Torso/head (5):** Hips, Spine, Chest, Neck, Head
- **Arms (8):** Shoulder.L/R, Upper Arm.L/R, Lower Arm.L/R, Hand.L/R
- **Legs (6):** Upper Leg.L/R, Lower Leg.L/R, Foot.L/R

Skipped: Fingers, Thumbs, Hand Hold (weapon attach), Toes, IK helpers.

### Editor scene specifics

- Editor knight loaded into the **main scene** at x=50 (not a separate scene) — the FPS camera + ArcRotateCamera see it from far away, the Editor camera frames it close.
- All editor knight meshes are `isPickable = false` so only the bone-picker spheres receive clicks.
- **Baked animations are kept (stopped, not disposed)** so the user can import them later via the modal.

### Multi-skin `prepare()` lesson (critical)

Knight GLB has **8 skeletons** that share TransformNodes (one skeleton per material primitive group). When you modify a bone's linked TransformNode rotation, only some of the 8 skinning matrices refresh — visible as one leg (e.g. Upper Leg.L) not updating while everything else does.

**Fix:** Call `s.prepare()` on **all 8 skeletons** every frame:

```ts
scene.onBeforeRenderObservable.add(() => {
  for (const s of skeletons) s.prepare()
})
```

`editor-scene.ts` collects them by walking the mesh hierarchy under the root and inserting `m.skeleton` into a Set.

### Bone-picker (click-only)

`bone-picker.ts`:
- Creates a yellow sphere mesh at each ACTIVE_BONE's world position
- Per-frame sync of sphere positions to their bones (bones move when rotations change)
- POINTERDOWN on a sphere fires `onSelect(boneName)`
- Selected bone's sphere swaps to red material

**Drag was implemented then removed** — both ribbon-tangent screen-space mapping (Model A) and full IK (Model B) were tried; user found drag UX unsalvageable for 3D rotation via 2D mouse motion. The knob rotation in `BoneControls.tsx` is what shipped.

### Bone rotation UI (`BoneControls.tsx`)

- Bone tree on top, categorized by Torso / Left Arm / Right Arm / Left Leg / Right Leg / IK Helpers via `categorize()` function
- Middle (ROTATE): 3 vertical 90×90 sphere knobs (X red, Y green, Z blue) — drag horizontally to rotate, sensitivity 0.008 rad/pixel. Each knob shows current Euler degree readout. `userSelect: 'none'` on panel + labels so dragging knobs doesn't select text. Selecting any bone enables them.
- Bottom (CROUCH) — **only visible when Hips is selected** (gated by `__editor.hasPositionControl(name)`): a single `Stepper` row for Y only (X/Z removed — locomotion lives in per-keyframe displacement now, not Hips). Layout: `[label] [−] [editable input] [cm] [+]` with a colored left bar. Click ± steps by `POS_STEP_M = 0.01` (1cm). **Scroll-wheel on hover** also steps (deltaY < 0 → +, > 0 → −) via a non-passive `wheel` listener (React's onWheel is passive by default — can't preventDefault). **Typed input**: click into the value, type a number, press Enter to jump directly. Hint: `down = crouch · up = rise`.
- Stepper translates in WORLD space via `node.translate(axis, delta, Space.WORLD)` — the bone's parent-local axes are rotated by Blender→Babylon conversion, so direct `position.xyz` editing produces axis-mixing. WORLD-space translation makes X/Y/Z match screen axes. The readout also reports world-space delta from `restWorldPositions` (cached on load via `computeWorldMatrix(true)` walk).
- **Undo coalescing on Stepper**: rapid clicks or wheel notches within `UNDO_BURST_MS = 300` collapse into ONE undo entry. Implementation: `lastStepTime` ref + `beginActionMaybe()` checks elapsed time before calling `pushUndo`. Avoids filling the 40-slot undo stack on a single scroll gesture.
- Below all controls: Undo + Redo side-by-side; Reset (full-width, red-tinted) below.

### Hips translation (crouch only — body shift)

Hips Y is the only translation axis exposed in the editor UI. Used for crouch / body height — body sinks, feet stay (visually) attached. The X/Z steppers were removed; locomotion now lives in **per-keyframe displacement** (see next section). Don't put X/Z back without a real reason — it conflicts with the displacement system.

- `POSITION_BONES = ['Hips']` in `src/editor/pose-store.ts` is the allow-list for translatable bones.
- `snapshotPose` / `applyPose` capture/restore an optional `positions: Record<string, [x,y,z]>` alongside `rotations`. Only Hips Y is meant to be non-rest in practice.
- `editor-scene.ts` extends `EditorSceneApi` with `restPositions` (local-parent) and `restWorldPositions` (world) so Reset restores both, and the readout can show world deltas.
- `engine.ts` exposes:
  - `translateSelectedBone(axis, deltaMeters)` — Space.WORLD via `node.translate`. No-ops on non-`POSITION_BONES` bones.
  - `getSelectedBonePosition()` — world-space delta from rest world position. `null` if no position control.
  - `hasPositionControl(boneName)` — for the UI to decide whether to render the CROUCH section.
- Undo/redo `Snap` type is `{ rotations, positions }`; capture+restore go through `snapshotPose`/`applyPose`.
- `animation-player.ts` builds a position track on the Hips bone from anchor `positions`. Plays in sync with rotation tracks.

### Locomotion via per-keyframe displacement (the actual character-movement system)

Each animation keyframe carries an optional `displacement: [x, y, z]` (metres) that defines **where the character's body is at this keyframe, relative to where the anim started**. At playback, the character's `root.position` is animated through those displacements, transformed by the root's rotation so the values are character-relative (Z = "the character's forward," not world-Z).

**Why this approach won (after rejecting two others):**
- ❌ **Tried first**: per-anim `forwardStep` scalar metadata — rejected by user as "two unrelated motions glued together" (animation visually swings in place, gameplay drags the body forward — disconnected).
- ❌ **Tried second**: Hips X/Z translation auto-promoted to root.position at playback — rejected because the editor preview showed body leaning while the gameplay showed full-character translation (authoring/playback visual mismatch was confusing).
- ✅ **Settled**: explicit per-keyframe XYZ inputs in the animation builder. Author sees exactly what they're committing to, editor preview physically moves the knight (matches gameplay 1:1), composes across anims (anim 2 picks up wherever anim 1 ended).

**Implementation:**
- `AnimKeyframe` type in `EditorPanel.tsx` has `displacement?: [number, number, number]` (metres).
- Each keyframe row in the animation builder shows a second sub-row: `pos X[ ] Y[ ] Z[ ] cm`. Inputs are in cm; converted to metres internally.
- `animation-player.ts playAnimation(scene, skeleton, keyframes, locomotionRoot?)` — if `locomotionRoot` provided and any keyframe has non-zero displacement, builds a `root.position` Vector3 track from the displacement values. Uses `Vector3.TransformNormal(localDelta, root.getWorldMatrix())` so the local displacement vector gets the root's rotation applied (character-relative motion).
- Editor preview path (`__editor.playAnimation`) passes `ed.root` so the editor knight physically moves during preview.
- Hero/opponent `playCustomAnimation` pass their `root` so the duel-scene characters move when bound keys fire.
- Persistence: `displacement` rides through `library.json` automatically (sparse — only saved when non-zero/explicit).

**Body-position readout (right panel, always visible):**
- Top of `BoneControls.tsx`, sits below the Bones/Style tabs, shows `X N · Y N · Z N · cm`.
- Polled every frame via `__editor.getBodyPosition()` — returns editor knight's current world position minus its starting world position (`ed.position`).
- Updates live as preview-anims play. Reads 0/0/0 at rest. Persists across multiple anim plays (because root.position is cumulative — anim 2 starts wherever anim 1 ended, and the readout reflects that).
- Reset snaps editor knight's root back to `ed.position` and the readout returns to 0/0/0.

### Animation builder + player

`animation-player.ts` `playAnimation(scene, skeleton, keyframes[])`:
1. Sort keyframes by time, drop duplicates within 0.001s
2. If first keyframe time > 0.001s, **prepend implicit frame 0 = current bone state** (so animation doesn't snap at start)
3. For each affected bone, build a Babylon `Animation` (rotationQuaternion track at 30fps) with the keys it has rotations for
4. `scene.beginDirectAnimation(node, animations, 0, lastFrame)` returns Animatable[] for cancellation

If a bone has only 1 key, it's skipped (`keys.length < 2` continue).

### Import-baked-animation modal

Opens via ⬇ button next to "Save Anchor". Shows:
- Dropdown of baked animations from the editor knight's GLB (with frame counts)
- Radio: **Original** (uses union of all targeted animations' `getKeys()` frames — most faithful) vs **Custom count** (default 8, range 2-30, evenly samples the timeline)
- On import: `engine.ts`'s `importBakedAnimation(name, sampleCount)` is called. `sampleCount=0` means Original mode.
- Creates N anchors named `{anim}_{frameIdx}` + one Animation tying them together

**Sample-count guidance (empirical):**

| Motion | Samples |
|---|---|
| Idle breathing / head nod | 3-5 |
| Single-axis swing (block raise) | 5-7 |
| Multi-bone action (sword strike) | 8-15 |
| Complex full-body | 15-25 |

Lower counts can fail visibly because quaternion slerp takes the geometrically shortest arc, which may not match the artist's authored rotation path. The user accepted 5+ as the working minimum for the slash anim.

### Key bindings

Each Animation row in EditorPanel has two text inputs: **Hero key** and **Opp key** (single character). On save, the resolved animation list is exposed to `window.__customAnims = [{name, resolved, heroKey, oppKey}, ...]`.

In `engine.ts` key handler, custom bindings are checked **before** the default Q/U/Space/Enter:

```ts
const customAnims = (window as any).__customAnims
if (customAnims) {
  for (const ca of customAnims) {
    if (ca.heroKey && ca.heroKey === key) {
      (window as any).__hero?.playCustomAnimation?.(ca.resolved); return
    }
    if (ca.oppKey && ca.oppKey === key) {
      (window as any).__opponent?.playCustomAnimation?.(ca.resolved); return
    }
  }
}
```

Hero/opponent each expose `playCustomAnimation(keyframes)`:
```ts
const playCustomAnimation = (keyframes: AnimationKeyframe[]) => {
  combatIdle?.pause()
  playAnimation(scene, skeleton, keyframes)
  const lastTime = keyframes[keyframes.length - 1]?.time ?? 0
  setTimeout(() => combatIdle?.play(true), Math.max(50, lastTime * 1000 + 200))
}
```

### Persistence: Vite dev plugin

`vite-plugins/animation-saver.ts` is dev-only. Loaded in `vite.config.ts` via `animationSaverPlugin()`. Adds two endpoints via `configureServer` middleware:

- `GET /api/animations` → reads `public/custom-animations/library.json`, returns empty object if missing
- `POST /api/animations` → writes JSON body to disk

For production this won't work — would need a real backend or save-to-disk-via-File-System-Access-API. Currently just a dev affordance.

### Race-condition gotcha (Initial anchor)

The Initial Position anchor used to be stored in state and inserted by both an async fetch from `/api/animations` and a sync editor-ready probe. Whichever ran `setAnchors` second won → Initial sometimes vanished.

**Fix:** Don't store it. Compute `displayedAnchors = [initialAnchor, ...anchors]` at render time using the editor's resolved rest pose. Filter persisted anchors to exclude `system: true` before POST.

### Window globals (current)

- `window.__bjs` = `{engine, scene, camera, fpCam, editorCam, setCameraMode}`
- `window.__hero` = `{playStrike, playBlock, getHeadNode, playCustomAnimation}`
- `window.__opponent` = `{playSlash, playBlock, playCustomAnimation}`
- `window.__editor` = `{snapshot, apply, reset, selectBone, getSelectedBone, addBoneSelectListener, rotateSelectedBone, translateSelectedBone, getSelectedBoneEuler, getSelectedBonePosition, hasPositionControl, getBodyPosition, setBonePickerActive, getEditorMaterials, setEditorMaterialColor, resetEditorMaterials, playAnimation, stopAnimation, pushUndo, undo, redo, canUndo, canRedo, getInitialAnchor, listBakedAnimations, importBakedAnimation, ...}`
- `window.__customAnims` = resolved custom animations `{name, heroKey, oppKey, resolved: [{anchor:{rotations, positions?}, time}]}` — `positions` flows through for Hips translation playback

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
- Hero + opponent both rendered with the same knight model (helmets visible on opp, hidden on hero for FP; hair hidden on both; backface culling off so mirrored geometry renders)
- Three cameras + UI toggle (Free Roam / Locked / Editor)
- Q/Space (hero) and U/Enter (opponent) → strike + block animations
- Combat_idle looping on both, pauses cleanly when other animations play
- Arrow-key camera movement (no page scroll)
- **In-browser pose/animation editor** with bone-pick, knob rotation, Hips Y stepper (CROUCH only, world-space, editable input + scroll + ± buttons), anchors, animation builder w/ in-place Edit, per-keyframe X/Y/Z displacement inputs for locomotion, BODY POSITION live readout in right panel, editor preview that physically moves the knight, undo+redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, with burst-coalescing for stepper), library persistence (rotations + positions + displacement), import-baked, per-character key bindings
- **Style tab** (right panel) — recolor every material slot (Blade, Wood, Emblem, Metal, etc.) on editor knight, Reset to defaults

⏳ **Pending:**
- HP system + damage timing
- Block-window mechanic (cancel damage if blocked in time)
- Additional strikes (left/right) — author via editor; one slash mirror would also work
- Dodges (left/right) — author via editor (use displacement for sidestep distance)
- Hit-react / block-react / death animations — author via editor
- NPC AI for opponent
- HUD: HP bars, key hints, attack-warning corners
- WASD free-roam locomotion in FP mode — input-driven `root.position` translation + walk-cycle anim on top (decoupled from the per-keyframe-displacement system, which is for discrete moves)
- Mouse-look for hero in Locked camera (currently click-drag)
- Production-safe persistence (current `/api/animations` is dev-only Vite middleware)

## Lessons captured (session ending 2026-05-21)

1. **Multi-skin GLBs need `prepare()` on every skeleton, every frame.** Knight has 8. Modifying a TransformNode that's linked from one bone won't refresh other skeletons' skinning matrices reliably. Symptom: one specific bone (e.g. Upper Leg.L) doesn't move while every other bone does.
2. **Drag-to-rotate bones in 3D is genuinely hard.** Tried ribbon-tangent projection (Model A) and full IK (Model B). Both inverted in ways the user found unintuitive. The final UX is sphere-click to select + 3 axis knobs to rotate. Avoid relitigating.
3. **`bone._linkedTransformNode` is the actual handle, not the bone.** Direct `scene.beginDirectAnimation(bone, ...)` silently fails — animate the linked TransformNode.
4. **Quaternion slerp takes the shortest arc.** Sparse keyframes for complex motions produce wrong-looking interpolations. Sample-count heuristics now in the Import section above.
5. **Animations need an implicit frame 0.** If user authors an animation starting at t=0.5s, prepend frame 0 = current bone state so it doesn't snap.
6. **Virtual list entries beat stateful "system" entries.** Initial Position anchor lives in render-time computed `displayedAnchors`, not React state. Eliminated a race condition between fetch hydrate + editor-ready probe.
7. **Dev-only Vite middleware is the cheap way to read/write JSON from the browser** during local dev. `configureServer` + `app.use` + check `req.url`. Won't survive prod build — fine for an author-time tool.
8. **3-frame imports of complex baked animations look broken.** Not a bug — slerp limitation. 5+ is the user's working minimum for sword_atk01.
9. **Bone-translation scope must be an allow-list, not a free-for-all.** `POSITION_BONES = ['Hips']` gates `translateSelectedBone` so dragging a Lower Arm bone can't stretch the forearm. Leaving the schema able to carry positions for other bones costs nothing — UI just won't render the controls until a bone is allow-listed.
10. **Wheel-scroll events on React `onWheel` are passive by default** in modern browsers — `preventDefault` is a no-op. To get a stepper that consumes the wheel without scrolling the page, attach via `addEventListener('wheel', fn, { passive: false })` in a useEffect.
11. **Burst-coalescing prevents undo-stack DoS.** A 30-notch wheel scroll = ONE undo entry, not 30. Implementation: only `pushUndo` when the previous step was >300ms ago (`UNDO_BURST_MS`). Same trick would apply to keyboard-held auto-repeat.
12. **Edit-in-place via the same draft form, not a separate "edit" mode.** When user clicks ✎ on an animation, load name + keyframes into the existing builder UI with an `editingId` flag. Save commits in place (no duplicate), Cancel discards. One UI surface, two modes. Header text flips `New Animation` ↔ `Edit Animation`.
13. **Display units ≠ underlying units.** Hips translation stepper stores meters internally (so Babylon math is consistent) but displays centimeters (so the readout is human-scale). The step size and display formatting are independent knobs — `step={0.003}` (m) + `value={pos.y * 100}` + `unit="cm"` + `precision={1}` gave a clean 0.3-cm-per-click feel without changing any engine code.
14. **Blender→Babylon axis convention bites bone-position editing.** Bone-local axes are rotated by the GLB import (Blender Y-up vs Babylon Y-up), so editing `node.position.x/y/z` directly produces axis-mixing (e.g. user types "Z" but body moves up+sideways). Fix: use `node.translate(axis, dist, Space.WORLD)` so Babylon does the parent-inverse-transform math. Readout should also be in world-space (cache rest world position via `computeWorldMatrix(true)` + `getAbsolutePosition`, show current-minus-rest).
15. **For character locomotion, authoring per-keyframe IS the right level.** Tried two simpler models first — per-anim `forwardStep` scalar (rejected: "two unrelated motions glued together") and Hips X/Z auto-promotion to root (rejected: editor preview leaned, gameplay translated, visual mismatch). Settling on per-keyframe displacement (`pos X[ ] Y[ ] Z[ ]` cm inputs in the keyframe row) won because the author can see exactly what each keyframe commits to and the editor preview shows the same physical motion as gameplay. Composes across anims naturally (anim 2's displacements are relative to wherever anim 1 ended).
16. **`Vector3.TransformNormal(localDelta, root.getWorldMatrix())` is the right helper for "this local direction, applied via the root's rotation."** Used to convert per-keyframe local displacement (X=character-right, Z=character-forward) into world-space root.position deltas. So a "+0.20 Z step" authored on the editor knight becomes "+20cm in character-forward direction" on a rotated hero/opp automatically.
17. **Always-visible state readouts beat per-feature readouts.** Body position display in right panel (not gated by selection, always shown) lets the user see character location independent of what they're doing. Polls every frame via raf — cheap. Important for chained animations where each anim starts from the previous one's endpoint.
18. **Native HTML `<select>` type-ahead steals keystrokes.** Pressing 'e' while a CameraToggle `<select>` had focus jumped to "Editor" option silently. Fix: `e.target.blur()` after onChange — release focus, keystrokes flow to game keydown handler. Worth checking any input/select for the same issue.
19. **Stepper UI scope creep is fine in moderation.** Started as just ± buttons. Added wheel-scroll → more useful. Added typed input for big jumps → essential. Burst-coalescing for undo → critical. Each addition was small but compounded into a nice tool. Stop when the user stops asking.
20. **Reset semantics matter as system grows.** Originally "Reset = restore rotations." Now "Reset = restore rotations + positions + Hips Y + editor knight root position." Every persistent piece of state needs an entry in the reset path. Skip one and the user will hit it eventually.

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
- **"What will it do?" = describe the EFFECT, not the implementation.** When proposing options or explaining changes, lead with what the user will *experience* (character moves forward, button appears, foot stays planted). Skip line counts, schema fields, code paths, and "implementation cost" unless they explicitly ask for code specifics. Stay brief.

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

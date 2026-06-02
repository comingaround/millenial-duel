# Duel Game — Project Notes

First-person sword-and-shield duel game (KCD-style). Web first, mobile later via Capacitor. Currently a working scene with hero (FP) + opponent (3rd-person target) and the first two combat animations (sword strike + shield block) on both characters. **Custom in-browser pose/animation editor is now operational** — used to author new attack/block animations bound to per-character keys, persisted to a JSON library. **Character Creator panel** lets the user build a third "Custom" model from geometric primitives + mesh clones of Model 1's body parts.

## Folder conventions (2026-05-26 onward)

- `claude_instructions/` (this folder) — Claude's project notes, lessons, design decisions. Edit freely.
- `.claude/` — settings only (`settings.local.json`). Do NOT put working notes here.

## ⚠️ Read this first (state after compaction)

- ✅ Duel scene (hero + opponent + 2 baked-key animations) — same as before
- ✅ Custom **pose/animation editor** at scene `(50, 0, 0)` — separate knight rig used purely as a posing puppet
- ✅ Editor features: bone-pick (sphere click), 3-axis knob rotation, **Hips X/Y/Z TRANSLATE stepper with leg-plant IK (feet stay glued to their world positions while body shifts)**, editable typed input + scroll-wheel + ± buttons, save Pose / Save Anchor, build Animation from anchor sequence with time offsets, **Initial Position virtual pose** (top of Poses list, system, can't delete), virtual Initial Position anchor, rename poses/anchors via ✎ icon, **Edit animation = ✎ opens full builder preloaded for in-place tinker**, **animations can pick an Initial Pose** that the model snaps to before keyframes play, import baked Knight GLB animations as anchor+animation pairs, per-animation hero/opponent key bindings
- ✅ **Three-model editor** — Model 1 + Model 2 + Custom along X axis at (50,0,0), (51.5,0,0), (53.0,0,0). Custom is skeleton-only (all GLB meshes hidden via `isVisible = false` flagged on load by `loadKnightInstance(..., hideAllMeshes=true)`) — user builds the body part-by-part via the Creator tab. Active-model selector in left dash routes all bone-control / anim-preview to the selected one. Each model row has ✎ edit (rename + visibility toggle).
- ✅ **Character Creator — slot-based wardrobe (June 2 rebuild)** — `src/editor/creator-parts.ts` was DELETED in full; the per-bone-clone Creator never recovered from the v3 knight swap (extraction returned distorted blobs, bone-index matching off-by-one, Body/armor extraction silently failed). Replaced with a **slot-based wardrobe**: Custom is a clone of the SAME v3 GLB Model 1/2 load with every mesh hidden up front; six slots flip mesh visibility (Body / Helmet / Body Armor / Leg Armor / Right Hand / Left Hand). Right + Left Hand slots also accept `library:<stem>` values that hide the native sword/shield + attach a weapon-library entry via `attachWeaponToHand`. Default kit = full set, so a fresh Custom looks identical to Model 1/2. Persists as `customSlots` block in library.json (legacy `creatorParts` field silently ignored, dropped on first save). Style tab works on Custom the same as Model 1/2 — see the June 2 PBR + Save/Revert/Reset entry below.
- ✅ **Weapon library (May 27)** — extra GLBs from `public/models/weapons/` loaded async at editor scene init via `loadWeaponLibrary()`. Each `WEAPON_CATALOGUE` entry has `targetMaxDim` (m) — geometry is auto-normalised via local-vertex × scale-factor multiply + `setVerticesData(..., updatable=true)`. Optional **`handleExtensionM`** (m) stretches only the handle (lower portion, head stays native via linear falloff). Optional **`gripAtBottom`** shifts the mesh origin to the handle tip so the knight grips the END of the pole, not the middle. Surfaced in Creator dropdown as `Weapons (library)` category. `attachWeaponToHand(scene, lib, stem, glbMeshes, skeleton, bone, rotDeg)` makes a weapon the primary equipment on any knight — hides existing bone-parented meshes, clones the source material (so PBR textures + albedoTextures + normal maps carry through), parents to the bone's linkedTransformNode with parent-scale-normalised user transform. Current axe: total ≈ 0.86m, grip at handle tip, rotation `(90, 90, 30)` deg on Model 1 + hero's Hand Hold.R.
- ✅ **Multi-model spawn ergonomics (May 26)** — `+` button on the Models section header spawns a fresh visible knight 1.5m to the right of the rightmost model. `👁`/`🚫` toggle on each model row hides/shows in-place (no edit modal). `🎯` button focuses the editor camera on that model — highlights orange when that's the currently-focused model. BODY POSITION (world) is now editable — typing X/Y/Z updates both `model.position` (spawn anchor) and `model.root.position`, so each model can spawn anywhere. Reset goes back to the edited spawn position.
- ✅ **Sync Play (May 28)** — sequenced multi-step session. **Opt-in models** via `+ add model ▼` chip dropdown (column-layout). **Steps** with per-model anim grid; step duration = max anim length (shorter anims pad with end pose); next step starts at cumulative offset. Per-step `×` delete + global Clear button. `▶ Play all steps`. State is React-only (ephemeral).
- ✅ **Mirror L↔R (May 27-28)** — `↔` button on every non-system Pose, Anchor, and Animation row in the left dashboard. **Delta-based mirror** math (not naive quat flip — the rig has asymmetric rest pose, so naive mirror produces garbage): `delta_R = inv(rest_R) ⊗ pose_R; pose_L = rest_L ⊗ mirror(delta_R)` plus `.L↔.R` bone-name swap. Position mirror negates `x`. Per-keyframe `displacement` negates `x`. Anim mirror clones referenced anchors with new IDs.
- ✅ **Knight v3 swap + v1→v3 retarget (May 28)** — `knight.glb` is now sister's fixed-export with proper PBR colours. Hero + Model 1 keep stock sword (axe removed; weapon library still loaded for Creator). **One-time retarget pipeline** transforms saved anchors/poses from v1's rest frame to v3's so existing anims still play correctly: `loadLegacyRestPose(scene, 'knight_v1_backup.glb')` extracts v1 rest, `EditorPanel` hydration applies delta-math retarget, writes `schemaVersion: 2` to library.json ONLY after successful retarget (anti-poison guard via `libraryRetargeted` React state). _Side-note: v3 GLB ships PBR materials throughout — until the June 2 Style rewrite below, the matCache loop skipped non-StandardMaterial entries, which silently left the Style tab empty._
- ✅ **Per-model Style tab with PBR + Save/Revert/Reset (June 2 rewrite)** — `matCache: Map<slot, Material>` (widened from `StandardMaterial`). The cache loop now branches by material class: StandardMaterial → existing hand-picked-palette override; **PBRMaterial → `src.clone(...)` per instance** so v3's textures + albedo carry through and each knight owns its own clone (no cross-model bleed). Style APIs dispatch by class — Standard writes `diffuseColor + ambientColor`, PBR writes `albedoColor`. Single Reset button replaced with **Save / Revert / Reset** trio: Save snapshots the active model's live colours into the engine's `savedEditorMaterials` map + bumps a listener so `EditorPanel` mirrors into React state → auto-save loop writes `editorMaterials` block to library.json. Revert applies the active model's saved entry back to its matCache. Reset restores baked baseline from each material's `metadata.baselineHex` (untouched semantic, doesn't clear saved). Hydration applies saved snapshot + seeds engine store so Revert works pre-save. Per-active-model semantics — switching active model loses unsaved edits on the previous one.
- ✅ **Two reset buttons** in right panel — Reset current model / Reset all models.
- ✅ **Inverse Kinematics on 5 bones** — 2-bone analytical IK shared across paths. **Hips** → both legs adapt so feet stay planted (crouch / lean / weight shift). **Hand.L / Hand.R** → arm IK reaches new hand world position (sword placement, reaches). **Foot.L / Foot.R** → leg IK reaches new foot world position (kick prep, lifting steps). All five share the same solver; pole hints differ. See "IK system" section below for the Babylon gotchas — lots of them.
- ✅ **Locomotion = per-keyframe displacement** (NOT per-anim metadata, NOT Hips-X/Z promotion — both tried and rejected). Each keyframe in the animation builder has `pos X[ ] Y[ ] Z[ ]` cm inputs = where the body is at this keyframe relative to anim-start position. At playback, character's `root.position` is animated to those positions, transformed through root's rotation (so +Z = "character's forward"). Composes across anims: anim 2 starts from wherever anim 1 ended.
- ✅ **Editor preview moves the editor knight** through the world (not just bones-in-place) so author sees the actual character motion. Reset snaps editor knight back to its starting world position.
- ✅ **Always-visible BODY POSITION readout** in right panel (top, both Bones/Style modes) — live world-space cm coords relative to starting position. Updates every frame.
- ✅ **Style tab** (right panel toggle) — per-model material recolor with native color pickers per material slot. Edits the ACTIVE model's matCache only — independent across Model 1 / Model 2 / Custom / future spawns. **Save / Revert / Reset** trio under the slot list (Save persists to library.json, Revert restores last-saved, Reset = baked GLB baseline). Works with both StandardMaterial (legacy assets) and PBRMaterial (v3 knight). Bone spheres hidden in Style mode.
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
├── .claude/
│   └── settings.local.json              blanket Edit + Write allow — no prompts
├── claude_instructions/
│   └── notes.md                         (this file)
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
│   │   ├── editor-scene.ts              loads 3 knight instances at x=50/51.5/53, exports ACTIVE_BONES (19), CustomSlots types + slot helpers + weapon library
│   │   ├── bone-picker.ts               yellow spheres at active bones, click-to-select (no drag)
│   │   ├── pose-store.ts                snapshotPose / applyPose helpers
│   │   ├── animation-player.ts          builds Babylon Animations from anchor keyframes
│   │   ├── BoneControls.tsx             right panel: Bones / Style / Creator tabs (Creator = 6-slot wardrobe)
│   │   ├── EditorPanel.tsx              left dashboard: poses/anchors/animations + import modal + customSlots persistence
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

### IK system — TRANSLATE-driven inverse kinematics on five bones

`POSITION_BONES` in `src/editor/pose-store.ts` is the allow-list of bones that get the X / Y / Z TRANSLATE stepper:

```ts
['Hips', 'Hand.L', 'Hand.R', 'Foot.L', 'Foot.R']
```

Each runs a different IK mode but all share the same `solveTwoBoneIK` + `buildSwingDeltaLocalRotation` core in `engine.ts`:

| Selected bone | Stepper translates | IK chain | Mode |
|---|---|---|---|
| Hips | Hips world position | Upper Leg + Lower Leg (both sides) | **Root-driven**: chain bends so feet stay at captured pre-translate world positions. Lets you crouch / lean / weight-shift without feet sliding. |
| Hand.L / Hand.R | Hand world target | Upper Arm + Lower Arm (same side) | **End-effector**: arm bends to reach the new hand world position. Hand bone itself isn't translated — it follows the chain. Pole hint = model's local `-Y` (elbow droops). |
| Foot.L / Foot.R | Foot world target | Upper Leg + Lower Leg (same side) | **End-effector**: leg bends to reach the new foot world position. Used for lifting a foot, stepping out, kick prep. Pole hint = model's local `+Z` (knee forward), same as Hips path. |

For Hips path, see "Algorithm per step" below. For Hand/Foot end-effector paths:
1. Read selected bone's current world position
2. `target = current + axisVec * delta`
3. Call `runArmIK(side, target)` or `runLegPlantIK(side, target)` — same internal solver, just different chain bones

Locomotion (character-physically-moves-through-world) is still per-keyframe displacement (separate system below) — different mechanism, doesn't use IK.

**Algorithm per step:**
1. Before `node.translate(axis, delta, Space.WORLD)`, capture `Foot.L` and `Foot.R` world positions.
2. Apply the Hips translation. All leg bones rigidly follow (they're children).
3. For each leg: run 2-bone analytical IK (`solveTwoBoneIK`) with the **post-translate** Upper Leg / Lower Leg / Foot world positions as the chain, and the **pre-translate** foot position as the target. Solver returns intended new world positions for the knee and foot.
4. Apply via position-based local rotation (see "IK gotchas" below).

**IK gotchas (all painful to find):**

1. **The GLB has negative Y scale** (Blender→glTF Z-up→Y-up conversion). Anywhere we'd need to extract rotation from a world matrix via `Matrix.decompose`, Babylon returns garbage because of the mirror. Fix: **never decompose a scaled/mirrored matrix to recover rotation**. Use either chain-composed quaternions, or position transforms only (which work correctly under arbitrary scale).
2. **`Bone.setRotationQuaternion(quat, Space.WORLD)` doesn't propagate** to the linked TransformNode that GLB-loaded rigs are actually driven by. Skeleton.prepare() reads from the linked node each frame, so any Bone API writes get reverted. Manipulate `node.rotationQuaternion` directly.
3. **`node.rotationQuaternion.copyFrom(q)` doesn't mark dirty.** Only the property setter (`node.rotationQuaternion = q`) marks the node's world matrix dirty for recomputation. Mutation in place silently fails to take effect.
4. **Bones don't use `(0, -1, 0)` as their down-axis universally.** The actual down-the-bone direction in a bone's LOCAL frame is `childNode.position.normalize()` (the child's local offset). Assuming a fixed axis breaks for rigs with rotated bone matrices.
5. **Shortest-arc rotation randomizes twist.** A naive `rotationFromTo(currentDir, newDir)` produces a bone that points the right way but with arbitrary twist around its length axis — visible as a foot/knee rolled to the side. Fix: anchor to the bone's REST local rotation and add only a **swing delta** in parent space. See `buildSwingDeltaLocalRotation` in `engine.ts`.
6. **Pole hint direction is rig-specific.** For this knight, the model's natural local forward is `+Z` (NOT `-Z` as the engine.ts comment used to claim). Pole hint = `m.root.getDirection(Vector3(0, 0, 1))`. If knees bend backward, flip the sign first before chasing other bugs.

**Application path (position-based, scale-safe):**
- `worldPosToParentLocal(parent, worldPos)`: `Matrix.invert` handles scale/mirror correctly for positions (unlike for rotations).
- `buildSwingDeltaLocalRotation(restLocalRot, childLocalDir, boneLocalPos, targetLocal)`:
  - `restChildInParent = restLocalRot.rotate(childLocalDir)` — where the child IS at rest, in parent frame
  - `desiredDir = (targetLocal - boneLocalPos).normalize()` — where the child SHOULD be
  - `delta = rotationFromTo(restChildInParent, desiredDir)` — shortest-arc swing in parent frame
  - Return `delta.multiply(restLocalRot)` (Babylon: apply rest first, then swing)

**Cache invalidation:** Reset (current model) and Reset All clear the chain-rest cache so IK re-anchors correctly. Same on `setActiveModel` switch (per-model IK).

**Diagnostic harnesses** (all headless Chromium against the dev server):
- `scripts/qa-knight.mjs` — baseline editor-camera screenshot of both knights.
- `scripts/qa-ik-diagnose.mjs` — Hips translate by a known delta, dump bone world positions before/after via `__editor.debugBoneWorld(name)`. Foot drift `[0, 0, 0]` = success. Add `window.__ikDebug = true` to surface internal solver values per IK call.
- `scripts/qa-arm-ik.mjs` — Hand.R translate +30cm Z, verify hand drift matches input.
- `scripts/qa-foot-ik.mjs` — Foot.L lift +20cm Y, verify foot drift matches input.

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
- `window.__editor` = `{snapshot, apply, reset, resetAll, selectBone, getSelectedBone, addBoneSelectListener, rotateSelectedBone, translateSelectedBone, getSelectedBoneEuler, getSelectedBonePosition, hasPositionControl, getBodyPosition, setBonePickerActive, getEditorMaterials, setEditorMaterialColor, resetEditorMaterials, playAnimation, playAnimationOnModel, stopAnimation, pushUndo, undo, redo, canUndo, canRedo, getInitialAnchor, listBakedAnimations, importBakedAnimation, getModels, getActiveModelIndex, setActiveModel, setModelVisible, getModelVisible, debugBoneWorld}`
- `window.__customAnims` = resolved custom animations `{name, heroKey, oppKey, resolved: [{anchor:{rotations, positions?}, time}]}` — `positions` flows through for Hips translation playback

## Character Creator — slot-based wardrobe (June 2 rebuild)

The original Creator was a per-bone-clone system: pick a bone, pick a body part, extract triangles by skinning weight, attach via `mesh.attachToBone()`. It worked on v1's knight (8 separate skins, per-part meshes named `Body`/`Hair`/`Shirt`/`Helmet`/etc.). The v3 swap on May 28 broke it: distorted "yellow blobs" that didn't match any body part. Two rounds of surgical fixes (rest-world transforms, name-based bone matching) didn't restore the feature. Rebuilt as a **slot-based wardrobe** on June 2, 2026.

### Design

Custom (Model 3) loads the **same v3 GLB** as Model 1/2 with every renderable mesh's `isVisible` flipped to false at load. The Creator tab toggles slot meshes back on per the user's slot selections.

Six slots, each picking ONE option:

| Slot         | Options                                                              | Default     |
|--------------|----------------------------------------------------------------------|-------------|
| Body         | `none` \| `body`                                                     | `body`      |
| Helmet       | `none` \| `helmet`                                                   | `helmet`    |
| Body Armor   | `none` \| `platebody`                                                | `platebody` |
| Leg Armor    | `none` \| `platelegs`                                                | `platelegs` |
| Right Hand   | `none` \| `sword` \| `library:axe_textured` \| `library:double_edge_axe` | `sword`     |
| Left Hand    | `none` \| `shield`                                                   | `shield`    |

Default kit = full equipment matching Model 1/2, so a fresh Custom looks like a "blank knight" the user can swap pieces on, not an empty skeleton.

### Implementation

- **`editor-scene.ts`** — `CustomSlots` type + `DEFAULT_CUSTOM_SLOTS` const + `SLOT_NATIVE_STEM` map (slot → mesh-name stem) + `SLOT_HAND_BONE` map (right→`Hand Hold.R`, left→`Hand Hold.L`) + `setCustomMeshVisibleByStem(model, stem, visible)` helper (dual-flags both `isVisible` AND `setEnabled`). `ModelInstance` gains optional `customSlots: CustomSlots` and `libraryAttachments: Map<'rightHand'|'leftHand', Mesh>` (populated only on Custom).
- **`engine.ts`** — `applySlotToCustom(model, slot, value)` is the single dispatcher. For body/helmet/bodyArmor/legArmor: flips visibility on the native stem. For rightHand/leftHand: disposes any prior library attachment, then either shows native, hides native, or attaches `library:<stem>` via the existing `attachWeaponToHand` (which itself uses `setEnabled(false)` to hide the in-skeleton sword/shield — that's WHY `setCustomMeshVisibleByStem` must dual-flag, otherwise going library→native leaves the native mesh disabled forever).
- **Engine API** — `getCustomSlots()`, `setCustomSlot(slot, value)`, `setCustomSlots(slots)`, `resetCustomSlots()`, `addCustomSlotsListener(fn)`, `getCustomSlotsRevision()`, `getWeaponLibrary()` (exposes the catalogue to the UI).
- **`BoneControls.tsx`** — `CreatorTab` renders six `<SlotToggleRow>` / `<SlotSelectRow>` rows + a "Reset to default kit" button. Library weapons populate Right/Left Hand selects as `library:<stem>` options.
- **`EditorPanel.tsx`** — `customSlotsRev` state replaces the prior `creatorPartsRev`. Hydration reads `data.customSlots` from library.json (silently ignores legacy `creatorParts`). Save payload includes `customSlots`, drops `creatorParts`.

### Real-time-update fix (same June 2 session)

First slot-rebuild ship had a bug: swapping weapons required Ctrl+R to see the change. Root cause: `attachWeaponToHand` hides the native via `setEnabled(false)`, but the slot toggle only set `isVisible`. Going library→native left the mesh disabled. Plus the newly-attached groupRoot wasn't getting its world matrix recomputed on the same frame it was created. Two fixes:

1. **`setCustomMeshVisibleByStem` now dual-flags `isVisible` + `setEnabled`** so both directions work regardless of which flag `attachWeaponToHand` uses.
2. **`attachWeaponToHand` now force-recomputes world matrices on the new groupRoot + children** right after parenting/transform via `computeWorldMatrix(true)`. Without this, the mesh exists in the scene but isn't rendered until a later frame triggers a parent-chain walk.

### What survived from the old Creator

- **Per-instance material cache** (`matCache: Map<slot, Material>` in `loadKnightInstance`, branched by material class) — untouched by the slot system. Style tab still recolours Custom independently from Model 1/2.
- **Weapon library** (`WEAPON_CATALOGUE` + `loadWeaponLibrary` + `attachWeaponToHand`) — fully reused for the Right/Left Hand slot options. Same `(90, 90, 30)` rotation + grip-at-bottom + handle stretch the prior hero attach used.
- **Debounced library.json save** (~500ms in EditorPanel) — reuse the same effect, just includes `customSlots` in the payload now instead of `creatorParts`.

### What got deleted

- **`src/editor/creator-parts.ts`** — entire ~700-line file (`extractBoneGeometry`, `createClonePart`, `createPropClonePart`, `createPropGroupClonePart`, `placeholderClone`, `applyColor`, `sampleMaterialHex`, all per-part mesh lifecycle).
- **Engine APIs** — `addCreatorPart`, `addCreatorPropClone`, `addCreatorPropGroupClone`, `addCreatorWeaponClone`, `updateCreatorPart`, `deleteCreatorPart`, `getCreatorParts`, `setCreatorParts`, `getCreatorTargets`, `addCreatorPartsListener`, `getCreatorPartsRevision`.
- **Types** — `CreatorPart`, `CreatorShape`, `CreatorPartInstance`.
- **Allowlists** — `BODY_MESH_STEMS`, `ARMOR_MESH_STEMS`.
- **Rest-matrix infrastructure** — `restBoneWorldMatrices: Map<string, Matrix>` + `restMeshWorldMatrices: Map<number, Matrix>` captured per model in `loadKnightInstance` (added during the v3 troubleshooting; nothing reads them now).
- **`ModelInstance.creatorParts: Map`** field.
- **`BoneControls.tsx`** — entire old CreatorTab + CategorizedParts + PartRow + PartTripleRow + PartNumInput + ~200 lines of unused styles.

### Accepted limitations

- **Slot collapse**: v3 baked Hair/Shirt/Pants/Shoes into the single `Body` mesh + materials. Users cannot turn off the shirt independently. Recolour via Style tab if needed.
- **No part stacking**: a Custom knight is exactly one Body + one Helmet + etc. To "swap" you replace; you don't accumulate. Aligns with what the user wanted ("not adding bullshit over and over").

### Lessons captured (rebuild session, 2026-06-02)

- **When two surgical fixes in a row don't restore broken behavior, scrap and rebuild instead of round 3.** Two rounds were spent on the per-bone-clone Creator after the v3 swap — rest-world matrix composition fix (correct math but didn't help symptoms) and name-based bone matching (also correct in principle, but the user still saw garbage). The data structure assumed v1's per-part mesh granularity. v3 collapsed all body pieces into one mesh + one material — the abstraction the old Creator was built on no longer existed. The right move was admitting the asset reality and building a smaller surface that matches it (slot toggles), not patching the old extraction logic.
- **Symptom diagnostic order matters.** First instinct on "yellow blobs" was bone-index mismatch (off-by-one shift between glTF joints and Babylon's bones array). That was a real hypothesis worth testing — but I should have first run the rest-world matrix decompose log on the live scene to confirm what `meshWorldMat` actually contained on v3. Pure code inspection couldn't distinguish "vertices in wrong space" from "wrong bone weighted". Future rule: when adding diagnostic logging, RUN the dev server and gather one round of data BEFORE proposing the next code fix.
- **When `attachWeaponToHand` uses `setEnabled(false)` and the new slot toggle uses `isVisible`, they're not symmetric.** The first slot rebuild ship missed this — weapons couldn't swap in real-time because going library→native left the native mesh disabled. Generalizable: when two code paths manipulate the same mesh's "hidden" state via different flags, always pick ONE flag and use it everywhere, or dual-flag at every entry point.
- **Babylon meshes parented to a bone at runtime need an explicit `computeWorldMatrix(true)` to render the same frame.** Without it, the new mesh is in the scene graph but its world matrix isn't computed until a later frame triggers a parent-chain walk. Visible symptom: "I have to Ctrl-R for the new weapon to appear". One-line fix in `attachWeaponToHand` after the scale/rotation set.
- **Slot-based UIs prevent "add bullshit twice"-class bugs by construction.** When each slot can only hold one option, accidentally double-clicking "Add" can't create duplicates. The old Creator's parts-list grew arbitrarily on every click, including silent failures — the slot system eliminates that whole failure mode.
- **GLB introspection from Python via the binary header pays off.** Used `python3 -c "import struct, json; ..."` on `public/models/knight.glb` to enumerate skin.joints, meshes, materials, and the node→mesh map directly from the JSON chunk. This is FASTER than booting the dev server + console.log just to learn the asset's structure. Useful diagnostic in future Babylon-asset triage.

### Lessons captured (Style PBR + Save/Revert/Reset session, 2026-06-02 evening)

- **An asset swap silently breaks features that filter by material class.** The May 28 v3 swap dropped a one-liner — `if (m.material.getClassName?.() !== 'StandardMaterial') continue` — to "preserve v3's textures". Functionally correct intent, but the Style tab populates from the same loop that the line guards. Result: empty Style list for over a week, no error, only noticed when the user opened the tab. Generalisable: whenever a guard says "skip X to preserve native behaviour", check what OTHER features iterate the same collection and assume the entries exist.
- **PBR materials need per-instance clones, not per-instance overrides, when you want recolour without losing textures.** Replacing with a new `StandardMaterial` (the old path) discards the artist's texture work. Building a fresh PBR from scratch loses all the settings. `src.clone(name)` is the right primitive — it copies properties + shares texture refs by reference (memory-friendly, since textures are read-only anyway). Each model now owns its own clone; recolouring writes to `clone.albedoColor`, leaving the source untouched.
- **Dispatch-by-class is cleaner than a "Material" superclass with a single `setColor(hex)` method.** Trying to abstract Standard's `diffuseColor + ambientColor` and PBR's `albedoColor` behind one interface would have meant either monkey-patching a `setColor` method onto Babylon's Material class or wrapping every cache entry in a `{ kind, mat, set(hex) }` object. Inline `instanceof` branches in the three Style APIs were ~12 lines total, no new abstraction, no type gymnastics. The cost of avoiding the abstraction is "two callsites to update if a third material type appears" — acceptable for a tool surface this small.
- **Auto-save vs manual Save: prevent the auto-save loop from triggering on live edits or Save becomes meaningless.** The codebase had an existing 500 ms debounced auto-save for `poses` / `anchors` / `animations` / `customSlots`. Naive extension would have added `editorMaterials` to the same payload and live colour drags would have persisted automatically — but then Revert can't exist (nothing to revert to; the disk already matches the live state). Solved by keeping the auto-save loop, but only mutating the React `editorMaterials` state from Save (not from live drags). The engine holds the live matCache; React state holds only the saved snapshot. Same payload write path, gated by an explicit gesture.
- **Listener pattern + React state mirror beats direct write.** `BoneControls` is rendered standalone (reads via `window.__editor`), so the Save button can't directly call `setEditorMaterials` in `EditorPanel`. Two options: (a) custom DOM events, (b) engine-side listener pattern matching the existing `addCustomSlotsListener`. Went with (b) for parity with the codebase. The engine owns the saved-snapshot store, fires `editorMaterialsListeners` on Save, `EditorPanel` subscribes once at mount and copies into React state. Auto-save loop sees the state-change dep and writes to disk. Three concerns cleanly separated: live state on engine, saved snapshot on engine, persistence in React.
- **Seed-don't-fire on hydration.** Initially the hydration path called `saveActiveEditorMaterials` for each loaded model to "register" them in the saved-snapshot store. That fired the listener, bumped React state, and the auto-save loop immediately rewrote the file we just loaded. Even though the data was identical, the round-trip is wasted work and would have shown up as a constant disk-touch on every page load. Replaced with `setSavedEditorMaterials(snap)` — a pure setter that updates the store without firing. Generalisable: any hydration path needs a "seed without notify" entry point distinct from the user-action "set and notify" path.

## Per-model Style tab (May 27 → PBR + Save/Revert/Reset rewrite June 2)

Each model owns its own materials. `ModelInstance.matCache: Map<slot, Material>` (widened from `StandardMaterial` on June 2) populated in `loadKnightInstance` — each call builds a fresh cache. Material clone name uses `editor_<modelName>_<slot>` for scene-graph uniqueness.

### Two-class population path

The cache loop branches by source material class:

- **StandardMaterial** (legacy flat-shaded asset) — replaced with a hand-picked `MAT_COLORS` palette entry as before (`new StandardMaterial(...)`, set `diffuseColor + ambientColor`, stash `baselineHex` on metadata).
- **PBRMaterial** (v3 knight) — `src.clone(name)` per instance. Babylon's clone shares textures by reference but gives each instance its own albedo state, so recolouring one knight no longer leaks into the others. Baseline = `src.albedoColor.toHexString()` stashed on cloned material's metadata.
- Anything else — skipped (cache stays sparse, slot doesn't appear in Style list).

Until this rewrite, the loop hard-skipped non-StandardMaterial entries (`m.material.getClassName() !== 'StandardMaterial'`), which silently emptied the Style tab on v3.

### Style APIs dispatch by class

`getEditorMaterials`, `setEditorMaterialColor`, `resetEditorMaterials` all read/write `active().matCache` only — recolouring one knight doesn't touch the others. Each routes to the right colour channel:

- `StandardMaterial` → `diffuseColor + ambientColor` (ambient = scale 0.5 for warm tint, matches the old palette path).
- `PBRMaterial` → `albedoColor`.

Style tab's `useEffect` re-fetches swatches on `activeModelIdx` change so switching active model in the left dash live-updates the list.

### Save / Revert / Reset trio

Three buttons sit in a row under the material list:

- **Save** — `engine.saveActiveEditorMaterials()` snapshots the ACTIVE model's live matCache colours into a module-scoped `savedEditorMaterials: Record<modelName, Record<slot, hex>>` map, then bumps `editorMaterialsRev` and fires `editorMaterialsListeners`. `EditorPanel` subscribes via `addEditorMaterialsListener`, mirrors the engine map into `editorMaterials` React state, and its existing debounced auto-save loop writes the new `editorMaterials` field into `library.json` on the next 500 ms tick.
- **Revert** — `engine.revertActiveEditorMaterials()` reads the active model's entry from `savedEditorMaterials` and writes each slot's saved hex back into the live matCache (no listener fire — disk state unchanged). Does nothing if the user has never saved this model.
- **Reset** — existing `engine.resetEditorMaterials()`. Iterates `active().matCache.values()` and restores from `material.metadata.baselineHex`. Does NOT touch `savedEditorMaterials`, so Reset → Revert undoes the Reset and returns to last-saved.

### Hydration

`EditorPanel` hydration reads `data.editorMaterials` from library.json and does THREE things, polling until the engine API is ready:

1. `setEditorMaterials(data.editorMaterials)` — React state, so the auto-save loop has a stable mirror.
2. `ed.applyEditorMaterials(data.editorMaterials)` — pushes the colours into live matCaches across all models by matching `model.name` to snapshot keys.
3. `ed.setSavedEditorMaterials(data.editorMaterials)` — seeds the engine's saved-snapshot store WITHOUT firing the listener, so Revert works immediately on first load without a prior Save, and the auto-save loop doesn't immediately rewrite the file it just loaded.

### Per-active-model semantics

Save only persists the active model's entry. If you edit Model 1, switch active to Model 2, hit Save, only Model 2 lands on disk; Model 1's unsaved tweaks stay live but get wiped on refresh. Quiet trap if you assume Save covers everything visible. Worth flagging if we ever wire a "Save all" gesture.

## Weapon library (May 27)

External weapon GLBs live in `public/models/weapons/`. Loaded async at editor-scene init via `loadWeaponLibrary(scene)` (exported from `editor-scene.ts`); engine.ts also calls it upfront to make weapons available to `createHero(scene, weaponLibrary)`.

### Catalogue + auto-normalise

`WEAPON_CATALOGUE` in `editor-scene.ts` is an array of optional-rich entries. Adding a new weapon = one entry + dropping its GLB. Current:

```ts
{
  file: 'axe_textured.glb',
  stem: 'axe_textured',
  kind: 'axe',
  targetMaxDim: 0.6,            // baseline normalize (head + handle)
  handleExtensionM: 0.2,        // optional handle stretch (anchored at head/handle ring)
  handleFractionFromBottom: 0.6,// bottom 60% of mesh = handle
  gripAtBottom: true,           // shift origin to handle tip → bone grips end of pole
}
```

At load, in this order:
1. `SceneLoader.ImportMeshAsync` loads the GLB.
2. `normalizeWeaponMeshes(meshes, targetMaxDim)` walks LOCAL vertex coords (NOT world — parent transforms after load can be lazy/contain Blender→glTF conversion factors), computes the union bbox, calculates `factor = targetMaxDim / maxLocalDim`, and bakes the factor into each mesh's positions via `setVerticesData(VertexBuffer.PositionKind, scaledPositions, /* updatable */ true)`. **Critical gotcha**: `updateVerticesData` silently no-ops on non-updatable GLB-loaded buffers — use `setVerticesData(..., true)` which replaces the buffer with an updatable one. After bake, mesh's local transform resets to identity + `parent = null`.
3. `extendWeaponHandle(meshes, extensionM, handleFractionFromBottom)` — optional. Stretches the handle only (head stays native size). Finds Y bbox, defines `handleTopY = minY + totalHeight * fraction`. For each vertex with `y < handleTopY`, translates DOWN by `(handleTopY - y) / handleLen * extensionM` (linear falloff anchored at the head/handle ring, so the silhouette stays watertight).
4. `shiftMeshOriginToBottom(meshes)` — optional (`gripAtBottom: true`). Translates all vertices up by `-minY` so the handle tip sits at mesh-local Y=0. When `attachWeaponToHand` parents the result at the hand bone, the bone's origin coincides with the handle tip — knight grips the END of the pole, not the middle. Runs AFTER the handle stretch so "bottom" reflects post-stretch length: change `handleExtensionM` and the grip-end stays at the (now longer/shorter) tip.

Current axe parameters land at total ≈ 0.86m (sword-ish), gripped at the bottom of the handle. Both attached at rotation `(90, 90, 30)` deg on Hand Hold.R for Model 1 + hero.

### `attachWeaponToHand` — install a weapon as primary equipment

Used for hero + Model 1 (Custom uses the Creator). Steps:
1. Look up the library entry by stem.
2. Walk `glbMeshes` of the target knight; for each non-skinned mesh whose parent chain leads to the target bone's linkedTransformNode, `setEnabled(false)`. This hides the stock GLB sword/shield on that hand.
3. Create a 0-vert `weapon_<stem>_root` Mesh parented to the bone's linkedTransformNode.
4. For each source weapon mesh: `VertexData.ExtractFromMesh(src, /* copy */ true)`, build a child Mesh, parent under root.
5. If source has a material with `clone()`, **clone it onto the child** — preserves PBR textures (albedoTexture + metallic + roughness + normal maps). Otherwise fall back to a plain StandardMaterial.
6. Apply user transform on the root, normalised by `parentNode.absoluteScaling` (knight bones carry ~100× baked armature scale → divide it out so a 1.0× multiplier = native size).

Hero gets the axe via `createHero(scene, weaponLibrary)` (engine.ts loads the library first then passes it). Editor scene equips Model 1 directly during `createEditorScene`.

### Material seeding for Creator clones

Updated for textures + per-source colour. For Creator's `createPropGroupClonePart`:
- Each child material is `src.material.clone(name)` (preserves PBR texture refs + per-piece colours).
- Falls back to StandardMaterial seeded from `sampleMaterialHex(src.material)` (reads `diffuseColor` for StandardMaterial OR `albedoColor` for PBRMaterial).
- `CreatorPartInstance.material` typed as `Material` (base class) so PBR clones work alongside StandardMaterial primitives.
- `applyColor(mat, hex)` is now any-typed; sets `diffuseColor` if present, falls back to `albedoColor` for PBR.

### Library weapon vs in-skeleton prop distinction

In `createPropGroupClonePart` and `createPropClonePart`:
- **In-skeleton props** (sword/shield parented under Model 1's `Hand Hold.R`): `src.parent !== null` → copy source's local position/rotation/scaling so the prop sits in its authored hand-relative pose.
- **Library weapons** (loaded standalone, `parent = null` after `normalizeWeaponMeshes` detaches): identity local → user offset/rot/bone choice fully determines pose. Without this, the debug-preview position (which moves the source mesh to a visible spot in the scene) leaked into clones, landing them 54m away from the bone.

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
- All combat actions are user-authored animations bound to user-chosen keys via the editor (no hardcoded Q/U/Space/Enter anymore)
- Combat_idle looping on both, pauses cleanly when other animations play
- Arrow-key camera movement (no page scroll)
- **Three-model editor** (Model 1 + Model 2 + Custom along X axis at 50 / 51.5 / 53). Custom is skeleton-only — built up via the Character Creator tab. Active-model selector routes all bone-control to one at a time. Each model row has ✎ rename + visibility toggle.
- **Character Creator** — adds primitives (sphere/box/cylinder/capsule) OR mesh clones from Model 1 onto any active bone of the Custom model. Per-part stepper editing (size/offset/rotation/colour) + bone retargeting. Clones use `bone.getAbsoluteInverseBindMatrix()` + `mesh.attachToBone()` so geometry follows the bone correctly through any pose. Persists to library.json.
- **In-browser pose/animation editor** with bone-pick, knob rotation, **IK-driven X/Y/Z translation on 5 bones (Hips → leg-plant; Hand.L/R → arm reach; Foot.L/R → leg reach)**, anchors, animation builder w/ in-place Edit, **Initial Pose virtual entry**, **per-animation Initial Pose dropdown** (snaps model before keyframes), per-keyframe X/Y/Z displacement inputs for locomotion (2-row UI), BODY POSITION live readout in right panel, editor preview that physically moves the knight, undo+redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, with burst-coalescing for stepper), library persistence (rotations + positions + displacement + initialPoseId), import-baked, per-character key bindings
- **Sync Play** section — pick one anim per model, fire both at once for combat practice
- **Style tab** (right panel) — recolor every material slot on the ACTIVE model (per-instance, supports PBR + StandardMaterial). Save / Revert / Reset trio under the swatch list — Save persists to library.json, Revert restores last-saved, Reset = baked GLB baseline.
- **Two reset buttons** — current model only OR all models

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

## Knight v3 swap + v1→v3 retarget (May 28)

### Asset swap

- `public/models/knight.glb` is now sister's `fixed-export` re-export of the RPG knight (19 meshes vs old 23, missing polygons fixed, proper PBR with hand-painted dark-blue armor + red shield + bronze cross). Original asset preserved as `public/models/knight_v1_backup.glb` for the one-time retarget pass; can be deleted after the retarget is verified.
- **matCache override now PBR-aware**: `loadKnightInstance` (editor-scene), `createHero`, and `createOpponent` all skip the matCache override when `m.material.getClassName() !== 'StandardMaterial'` — keeps the v3 GLB's PBR materials + textures. StandardMaterial slots (legacy flat-shaded path) still get the hand-picked `MAT_COLORS` palette.
- **Hero + Model 1 keep the stock sword** — `attachWeaponToHand('axe_textured', ...)` removed from both. Weapon library still loaded so the Creator's `Weapons (library)` category works on Custom. Re-enable in-place if axe-as-primary returns.
- Bone count went 37 → 36 (one bone trimmed in v3); no code changes needed since all bone lookups are by name and ACTIVE_BONES only references the 19 combat-relevant ones.

### One-time retarget pipeline

The v3 rig has a DIFFERENT rest pose than v1 (Hips position `y=0.82` vs `y=0.0008`; rotations also differ). Saved anchors/poses store ABSOLUTE local rotations + Hips positions authored against v1's rest, so directly playing them on v3 caused the hero to sink under the ground + bones to twist wrong. Solution: one-time pre-load pass that transforms every saved value to v3-equivalent absolute coords.

**`loadLegacyRestPose(scene, 'knight_v1_backup.glb')`** in `editor-scene.ts` — loads the backup GLB just to extract its rest rotations + positions (per-bone), then disposes the loaded scene graph. Returns null if file missing (post-retarget cleanup). Result is exposed on `EditorSceneApi.legacyRestPose` and via `__editor.getLegacyRestPose()`.

**`getInitialAnchor()`** extended to also return `positions` (was rotations-only). The retarget pass needs BOTH rotations and positions for each rig's rest.

**Retarget math** (per anchor / pose, in `EditorPanel.tsx` hydration):
```ts
// Rotation: same delta-from-rest, re-expressed in v3's rest frame
delta = inv(restV1[bone]) ⊗ savedRotation[bone]
newRotation[bone] = restV3[bone] ⊗ delta

// Position: same delta from rest, anchored to v3's rest origin
newPosition[bone] = restV3.pos[bone] + (savedPosition[bone] - restV1.pos[bone])
```

For bones present in v1 but missing in v3 (or vice versa): fall through, write the original value (warn in console).

**Hydration flow**:
1. Fetch `/api/animations`.
2. If `data.schemaVersion !== 2` (needs retarget), wait for `__editor.getLegacyRestPose && getInitialAnchor()` to become ready (poll 200ms, 15s timeout — engine init is async).
3. Apply retarget to every pose + anchor; set state.
4. Save effect fires 500ms later and writes `schemaVersion: 2` IF retarget actually ran.

**Critical anti-poison guard**: `libraryRetargeted` state. The save effect only writes `schemaVersion: 2` when this flag is true — set true ONLY when (a) loaded data already had the marker OR (b) we just successfully ran the retarget. A skipped retarget (legacy GLB missing, editor not ready in time) loads the data as-is WITHOUT writing the marker — next load with the GLB back will retry. Without this guard, the first imperfect load would poison `library.json` with `schemaVersion: 2` on unretargeted data, and subsequent loads would skip retarget forever, leaving the rig sinking permanently.

### Sync Play — sequenced steps + opt-in models (May 27 evening)

Earlier session's per-model-anim-slot UI replaced with **synchronized step sequencing**:

- **Opt-in model chips**: section starts empty. Pick from a `+ add model` dropdown (column-layout, label / chips / dropdown each on its own line, always visible regardless of chip presence). Removing a model also drops it from every step's anim map.
- **Steps**: `Step 1 / Step 2 / …`, each with one anim selector per opted-in model. `+ Add step` appends. `×` on a step deletes it.
- **▶ Play all steps**: schedules each step's anims via `setTimeout(start, cumulativeMs)`. Per-step duration = max anim length in that step (shorter-anim models hold their end pose while the longest finishes). Next step starts at `cumulativeMs += stepDur`.
- **Clear** button (full-width ghost, only visible when there's anything to clear) drops models + steps.
- **No persistence**: sessions are React-state ephemeral.

State shape: `syncModels: number[]` + `syncSteps: Array<{ id: string; anims: Record<modelIdx, animId> }>`.

### Mirror buttons on Pose / Anchor / Animation rows

- ↔ button on every non-system row (poses, anchors, animations) in the left dashboard.
- Uses **delta-based mirror** (not naive `(x, -y, -z, w)` on absolute rotations) because the knight rig has an asymmetric rest pose (artist baked in stance offsets: weight-shift, foot rotation, etc — `Upper Leg.L` vs `mirror(Upper Leg.R)` diverges by up to 1.9 in quat components).

Math:
```ts
delta_R   = inv(rest_R) ⊗ pose_R              // R's delta away from its rest
mirror_d  = (x, -y, -z, w) of delta_R         // reflect across YZ-plane (sagittal)
pose_L    = rest_L ⊗ mirror_d                 // apply on L's rest
```

Plus bone-name swap `.L ↔ .R`. Midline bones (Hips/Spine/Chest/Neck/Head) handled naturally — source rest == target rest so the formula collapses to in-place mirror. Position mirror just negates `x`. Per-keyframe `displacement` negates `x`.

**Shared helpers** in `EditorPanel.tsx`:
- `getRestRotations()` — pulls active model's rest from `__editor.getInitialAnchor().rotations`.
- `newMirrorId(prefix)` — UUID with fallback.
- `mirrorBoneName`, `qInv`, `qMul`, `mirrorRotations(r, rest)`, `mirrorPositions(p)`, `mirrorDisplacement(d)`.

**Anim mirror** (`onMirrorAnimation`) also handles the indirection: clones each non-system referenced anchor with mirrored data, builds new keyframes referencing the new anchors, mirrored per-keyframe displacement. System anchors (Initial Position — bilaterally symmetric rest) pass through reference unchanged. `heroKey/oppKey` deliberately NOT carried over (avoid key collision with original).

## Lessons captured (knight swap + retarget + sync sequencing session, 2026-05-28)

G1. **Asset swap is more than a file rename.** Even when sister "only" fixed clipping polygons, the v3 rest pose was DIFFERENT enough (Hips `y=0.82` vs `y=0.0008`) to break every saved Hips position in the existing animation library. Saved animations store ABSOLUTE local rotations + positions authored against the OLD rig's rest. Lesson: any rig swap needs a retarget pipeline OR a redo of the anim library. The retarget math (delta from rest, re-expressed on new rest) is mechanical: `delta = inv(restOld) ⊗ saved; new = restNew ⊗ delta`. ~30 LOC including position math.

G2. **One-time-marker design needs a "did the work actually happen?" guard.** First version of the retarget wrote `schemaVersion: 2` on every save after hydration — but if the retarget was skipped (engine async-init not ready in 15s, legacy GLB missing, etc), the save still wrote `2` on un-retargeted data. Subsequent loads saw the marker and skipped retarget forever, locking the file in a broken state. Fix: only write the marker when (a) it was already there on load OR (b) the retarget pass actually ran successfully (tracked via `libraryRetargeted` React state). Generalises: any "this data has been migrated" marker must be set ONLY by the migration code, never as a default on first save.

G3. **PBR vs StandardMaterial branching in matCache override.** v3 ships PBR with hand-painted textures; v1 shipped StandardMaterial with named-only slots. Single guard line `if (m.material.getClassName?.() !== 'StandardMaterial') continue` in three matCache loops (editor-scene's loadKnightInstance + hero.ts + opponent.ts) keeps PBR alone and preserves legacy flat-color path. Same Style tab API works for both (`applyColor` is any-typed: writes `diffuseColor` if present, falls back to `albedoColor` for PBR — already shipped earlier for textured prop clones).

G4. **Sync Play step-sequencing > model-sequencing for combat practice.** Earlier UI had one anim slot per model; user wanted "step 1: both swing simultaneously, step 2: both block simultaneously" not "model 1 plays its sequence in isolation while model 2 plays its sequence in isolation". Re-architected to step-first hierarchy: `Steps × Models grid`. Per-step duration = max anim length so shorter anims pad with their end pose. Cumulative timing via setTimeout chain. Scales naturally to opt-in N models — no fixed 2-model assumption.

G5. **Opt-in chip lists for sessions of variable size.** Models list grows from `+ Add Model` button — sync sessions opt them in via `+ add model ▼` dropdown filtered to non-already-included entries. Removing also cleans every reference (each step's anim map drops the removed idx). Column-layout (label / chips / dropdown each own row) keeps the `+ add` button findable whether or not chips exist — avoids the "where's the add button when nothing's added?" UX trap.

G6. **Asymmetric rest pose breaks naive quat mirror.** `(x, -y, -z, w)` on absolute rotations only works when the rig's bone-local frames are themselves symmetric across the sagittal plane. Knight rigs from glTF export typically have stance asymmetries baked in (weight-shift, foot turn). Verified via Playwright probe: `Upper Leg.L` vs `mirror(Upper Leg.R)` differed by 1.9 in quat components. Delta-based mirror (mirror the rotation away from rest, then apply to the OTHER side's rest) handles arbitrary asymmetric rigs correctly. Same math pattern applies to retargeting between two different rigs (delta from rest is the canonical "intent" representation).

G7. **Mirror buttons on poses + anchors, not just animations.** Author one asymmetric stance, click ↔, you've got the opposite-side counterpart immediately for the other half of any sparring practice. Combined with anim-level mirror, halves the authoring effort for combat moves (one strike + click → both sides). Cost: one shared `getRestRotations()` helper + 30 LOC of common mirror math reused across three handlers.

## Lessons captured (weapon polish + native-GLB A/B session, 2026-05-27 evening)

F1. **Weapon handle stretch via linear-falloff vertex shift.** "Extend only the handle, keep the head untouched" maps cleanly to: find Y bbox, pick a head/handle threshold (bottom 60% = handle), for each vertex below threshold translate down by `(handleTopY - y) / handleLen * extensionM`. Top vertex of handle moves 0, bottom vertex moves `extensionM`. Anchored at head, so the head/handle ring stays watertight. Avoids the discontinuity of "translate all vertices below threshold by a fixed amount" (which would tear the mesh at the join).

F2. **Grip-at-bottom = shift mesh origin to handle tip.** `attachWeaponToHand` parents the weapon at the bone's origin. If the mesh's authored origin is at the middle of the pole, the knight grips the middle. To grip the END, just translate every vertex up by `-minY` so the lowest point lands at Y=0 in mesh-local. The bone's origin then coincides with the handle tip. Crucially this must run AFTER `extendWeaponHandle` — measuring `minY` against the post-stretched geometry means changing the extension later keeps the grip at the new tip automatically. The two ops compose cleanly via load-time vertex baking, no per-instance transform fiddling needed.

F3. **Sister's re-export from Blender vs ours from fbx2gltf — identical materials, different rest poses.** Native GLB export (combat stance) and fbx2gltf-converted GLB (T-pose) ship the SAME 23 meshes + the SAME PBR materials. The textures/colours that were "missing" on the older converted version were because of the original FBX export settings, not the conversion. Lesson: when asset-store colours look wrong post-conversion, re-export from Blender with clean settings before suspecting fbx2gltf. Also: visual issues in the asset can persist across BOTH re-exports — sometimes the source FBX itself just has missing/misplaced submeshes (artist's authoring quirk), not a pipeline problem. Decision: stick with our current `knight.glb` + `matCache` palette since both v2 imports had the same gaps and switching would invalidate IK + saved poses + rest matrices.

F4. **Catalogue-driven per-weapon transforms scale better than per-call args.** Adding `handleExtensionM`/`handleFractionFromBottom`/`gripAtBottom` to `WEAPON_CATALOGUE` entries (rather than function args) means future weapons just declare their treatment once. Sword would set `gripAtBottom: false`, no handle stretch. Hammer would set both. The loader does the right thing without callers needing to know each weapon's geometry quirks. Auto-categorise the result and the engine + UI + Creator all consume identically.

## Lessons captured (Weapon library + Body/Armor split session, 2026-05-27)

E1. **Babylon `updateVerticesData` silently no-ops on non-updatable buffers.** GLB-loaded geometry defaults to non-updatable. Use `mesh.setVerticesData(VertexBuffer.PositionKind, newPositions, /* updatable */ true)` which REPLACES the buffer with an updatable one. Cost a session of head-scratching: the bake math was right, factor was right, but vertices never updated → 30× shrink looked like wrong-direction maths. Verified via Playwright by measuring world bounds before vs after.

E2. **Compute weapon bbox from LOCAL vertex coords, not world.** World-matrix bounding boxes after GLB load can be lazy or contaminated by parent transforms (Blender→glTF -90° X-rotation, unit-conversion scales, etc). Local vertex walk + uniform scale + `setVerticesData(..., true)` is the reliable normalise path. Vertices baked at normalised scale, mesh's local transform reset to identity + `parent = null` = self-contained source ready for cloning.

E3. **Source material `.clone(name)` preserves PBR textures.** Per-clone independence requires NEW material instances (so disposal + recolour don't affect the source), but new StandardMaterial loses albedoTexture + normalMap + roughness. `material.clone()` works on both StandardMaterial and PBRMaterial and copies all texture refs. `CreatorPartInstance.material` widened to `Material` base type. `applyColor` made any-typed: writes `diffuseColor` for StandardMaterial or `albedoColor` for PBR.

E4. **Library-weapon vs in-skeleton-prop is detectable via `parent === null`.** After `normalizeWeaponMeshes`, library source meshes have parent=null (detached). In-skeleton props (sword/shield parented to Hand Hold bones on Model 1) keep their bone parent. Use this to decide whether to copy `src.position/rotation/scaling` on clone (in-skeleton: yes, to preserve hand-relative pose) or default to identity (library: yes, user controls fully). Without this distinction, the debug-preview position bleeds into clones.

E5. **`attachToBone` doesn't propagate `setEnabled` from model root.** The mesh is parented to a Bone object (not a TransformNode in the model's hierarchy), so toggling root visibility leaves bone-attached creator parts visible. Fix: in `setModelVisible`, iterate `model.creatorParts.values()` and `setEnabled` each part's mesh + groupChildren directly. Bone-picker spheres also live scene-level, not parented to root — same explicit toggle needed.

E6. **List-render maps over models but state was 2-fixed-slots.** SyncPlay had `syncAnim1`/`syncAnim2` for 3+ models, so any model with `idx ≥ 1` shared the second slot — Custom row mirrored Model 2's dropdown. Replace with `syncAnims: string[]` indexed by model so it scales to any number of models, including dynamically added ones.

E7. **Empty option text + native `<select>` styling don't match OS theme.** `<optgroup>` labels render with OS theme — invisible on dark dropdowns. Workaround: use disabled `<option>` rows as section headers, build 3-level hierarchy from regular options with unicode-space indentation. Same applies to the parts list — mirror that taxonomy with custom div headers (since we control the styling there).

E8. **Per-instance vs shared caches matter for downstream features.** The `matCache` was originally shared across all editor knights to save GPU. Sharing means recolouring is global — fine for an aesthetic preview, useless for "each model has its own style". Lift the cache to per-`ModelInstance` and route engine APIs through `active().matCache`. Per-material baseline (for Reset) goes on `material.metadata.baselineHex` so the baseline lookup follows the material wherever it goes, no scene-wide map.

E9. **Asset-shop "multi-tone" previews lie sometimes.** Quaternius's copper-axe FBX ships single-material, single-colour (white vertex colours, single PBR `albedoColor`). The shop preview's "different layers" is marketing render lighting. To get real multi-tone, find an FBX that actually ships a hand-painted UV-mapped texture atlas alongside (e.g., the medieval-axe pack with `axe tex.jpg` + normal/specular maps). Probe via Playwright: read material class + texture presence + vertex-colour range before assuming a problem with conversion.

E10. **Mesh-layer filtering is the right abstraction for body-vs-armor cloning.** Don't try to extract "armor" by inspecting material names or vertex weights cleverly — the GLB ships armor as separate sub-meshes (`Helmet`, `Platebody`, `Platelegs`). Just allowlist source-mesh stems per category. Single field on the schema, one line in the extraction loop. Clean and extensible (Cloth as a third layer is trivial).

## Lessons captured (Creator polish + props + grouping session, 2026-05-26 evening)

D1. **Native `<select>` is the wrong tool when you need nested categories with theme-aware styling.** `<optgroup>` doesn't nest, and its label is rendered by the OS — invisible on dark dropdowns in every browser tested. Workaround: build the hierarchy from regular `<option>` rows with 3 styles (category / subcategory / item) + unicode-space indentation. Works on every browser/OS pair without a custom dropdown component. If you ever need real hover states / icons / search, that's when you commit to a custom dropdown.

D2. **GLB props (sword/shield) are non-skinned meshes parented under bone TransformNodes.** The skinned-clone path (`getAbsoluteInverseBindMatrix()` + `attachToBone()`) silently produces zero triangles for them. Need a separate path: copy mesh's vertex data, parent the clone to the same bone's `_linkedTransformNode`, copy the source mesh's local position/rotation/scaling. Engine auto-resolves the bone by walking the source mesh's parent chain — user never has to know which bone holds the sword.

D3. **Multi-primitive props need a group root.** A sword exported as `Sword_primitive0..3` (4 materials) lands as 4 separate Meshes in Babylon. To rotate / scale / colour them as one unit: create a 0-vertex Mesh under the bone, parent all 4 children to it, and apply user transforms to the root. Children keep their source-local poses → group transforms rigidly. `CreatorPartInstance.groupChildren` tracks the array for disposal + color application.

D4. **Stem-grouping for GLB primitives is regex-trivial.** Babylon's loader names multi-material primitives `<stem>_primitive<N>`. One `match(/^(.*)_primitive\d+$/)` + Map-by-stem gives clean prop groups in `getCreatorTargets()`. Single-primitive props fall through unchanged (stem = full name, members = [name]).

D5. **Accordion-by-default on long lists.** When the user can accumulate dozens of parts (one per body bone + props), the right panel becomes unscrollable text. Collapse each PartRow body by default, keep header (title + bone selector) always visible — they can scan + retarget bones without expanding. Each row's expand state is local React (not persisted) — opens collapsed on every tab entry, matching the "1-click to engage" UX rule.

D6. **Header layout: stack ≫ inline when content is variable.** First Creator add row had shape + bone + button on one line and looked cramped + sometimes pushed the button off. Stacking the bone selector below the title in PartRow (row 1: title + delete; row 2: bone selector) fixed the cramp AND made the row scannable when collapsed. Inline is fine for fixed-width content; stack when one of the items can grow (like long bone names).

D7. **3-level dropdown nesting in native `<select>` via leading spaces.** ` ` (regular) and ` ` (non-breaking) both render in option text. Three indents = `'        '` (8 spaces). Reads as a tree on every browser. Limitation: items can't be styled differently by depth in the dropdown panel (browser renders all options identically except for the disabled background) — but the 3-style trick using bg + colour on disabled rows gives enough hierarchy.

D8. **Right panel needs vertical space allocation discipline.** The CameraToggle pill sits at `right: 20; bottom: 20`. If the BoneControls panel uses `bottom: 0`, it covers the toggle on every interaction. Always reserve ~70-80px at bottom for floating widgets. Outer panel `overflow: hidden` + inner sections each owning their own `overflowY: auto` is the right scroll pattern — double scrollbars (outer + inner) confuse users.

D9. **Engine APIs > React state for runtime entities.** Creator parts, models, etc. live on the engine because they're 3D Babylon objects. React state is just a mirror. Pattern: engine exposes `addX/getX/setX/addXListener`. React subscribes via `useEffect` + sets a tick counter on every event. The save effect lists the tick counter as a dep, so any mutation triggers the debounced POST. Zero double-source-of-truth bugs.

D10. **Editable read-outs need focus-aware draft state.** `BodyPosInput` (and `PartNumInput`) hold a local string `text` state that syncs from prop value ONLY when not focused. Without this, the per-frame rAF polling overwrites what the user is typing. Commit on blur OR Enter; revert on Escape. Reusable pattern for any "display + edit" cell.

## Lessons captured (Character Creator session, 2026-05-26)

C1. **Babylon GLB rigs have TWO bone-position systems that DON'T match.** `bone._linkedTransformNode.getWorldMatrix()` reflects the scene-graph hierarchy with Blender→glTF conversion transforms baked in (extreme scale + translation values). `bone.getAbsoluteInverseBindMatrix()` reflects the canonical skinning math actually used by the shader. For "parent a static primitive to a bone", linkedTransformNode works fine. For "extract skinned vertices into bone-local space and re-attach", you MUST use `getAbsoluteInverseBindMatrix()` + `attachToBone(bone, refMesh)` — the canonical Babylon API. Naive parenting put extracted geometry at world bounds `(-945, -5733, 7289)`.

C2. **`mesh.attachToBone(bone, referenceMesh)` is the canonical API for bone-following non-skinned meshes.** Babylon handles the per-frame world-matrix recompute via the bone + refMesh combo. The refMesh's world matrix anchors the bone-attached geometry into scene world space. Pick ANY skinned mesh on the target model that uses a skeleton containing the bone.

C3. **Multi-skin GLBs have one inverse-bind matrix PER SKIN PER BONE.** When extracting vertices from multiple skinned meshes that all share a "Head" bone, fetch the per-mesh skeleton's bone and use ITS `getAbsoluteInverseBindMatrix()` — different skins may have subtly different bind matrices.

C4. **Triangle-ownership filtering: prefer "any vertex ≥ threshold" over "all 3 verts dominant."** The strict rule produces clean partitions with seams; the loose rule produces overlapping coverage with no gaps. For visual extraction (e.g. "the head shape"), overlap is harmless. For mesh decomposition (each tri owned by exactly one bone), strict is needed.

C5. **Parent-scale normalisation is needed for primitives but NOT for clones.** Primitives' vertex positions are in the mesh's own local space (created at unit size); when parented to a bone with armature scale 100x baked in, a `mesh.scaling = 0.15` renders as 15m world. Divide user-meters by `parent.absoluteScaling` before assignment. Clones' vertices are already in bone-local-skeleton space via the inverse-bind transform, so their scale is a direct multiplier (1.0 = native). Offsets are normalised in both cases (offsets are always "user-meters in world").

C6. **`alwaysSelectAsActiveMesh = true` for bone-attached dynamic meshes.** Without it, Babylon's frustum-culling pass can intermittently hide a mesh whose bounding info hasn't refreshed since the bone moved. The performance hit is negligible for a handful of creator parts.

C7. **Display-vs-storage unit mismatch is fine if labels make it explicit.** Primitive `scale` is stored in metres and displayed × 100 as cm. Clone `scale` is stored as a multiplier (1.0) and displayed × 100 as "%". Same input field, different label. The math just works because 100 ÷ 100 = 1.0 in both cases — the user reads "100" as "100 cm" or "100 %" depending on the row label.

C8. **Skeleton-only model load = `m.isVisible = false` on every renderable Mesh.** Bones / TransformNodes / skeleton hierarchy are untouched. Parts parented to bones render against an otherwise-empty hierarchy. Costs near-zero — Babylon skips the hidden meshes in the render pass but `skeleton.prepare()` still runs (for any bones that something IS parented to).

C9. **React state vs engine state for "lives outside React but needs to trigger persistence."** Creator parts live on the engine (Map on each ModelInstance). To trigger the debounced save useEffect when parts mutate, expose an `addCreatorPartsListener(fn) → unsub` API + bump a React `creatorPartsRev` counter on every event → list it in the save effect's dep array. The PARTS themselves never enter React state; only a tick counter does. Clean separation.

C10. **Engine async-init + persistence hydrate need a retry loop.** `createEditorScene` is async (GLB load). The library.json fetch may resolve before the editor is ready. Pattern: try to apply immediately; if `__editor.setCreatorParts` doesn't exist yet, poll every 200ms up to 10s. Same pattern works for any "wait for engine to register an API after initial mount."

C11. **Flexbox layout for narrow side panels.** When fitting "shape select + bone select + Add button" into a ~240px column with long item names: selects get `flex: 1 1 80px` + `min-width: 0` (share remaining, can shrink past content); button gets `flex: 0 0 auto` (fixed, never pushed off); row gets `flex-wrap: wrap` (button drops to second line gracefully on extreme narrow widths). Long names truncate visually; the dropdown still shows them in full.

C12. **Don't delete diagnostic console.logs after first success.** The `[creator] clone 'Head': extracted 1116 triangles, 688 vertices` log paid for itself twice during debugging — once to confirm extraction was working at all, once to confirm world-bound math was off. Keep them in until the feature stabilises in production use.

## Lessons captured (session ending 2026-05-21)

1. **Multi-skin GLBs need `prepare()` on every skeleton, every frame.** Knight has 8. Modifying a TransformNode that's linked from one bone won't refresh other skeletons' skinning matrices reliably. Symptom: one specific bone (e.g. Upper Leg.L) doesn't move while every other bone does.
2. **Drag-to-rotate bones in 3D is genuinely hard.** Tried ribbon-tangent projection (Model A) and full IK (Model B). Both inverted in ways the user found unintuitive. The final UX is sphere-click to select + 3 axis knobs to rotate. Avoid relitigating.
3. **`bone._linkedTransformNode` is the actual handle, not the bone.** Direct `scene.beginDirectAnimation(bone, ...)` silently fails — animate the linked TransformNode.
4. **Quaternion slerp takes the shortest arc.** Sparse keyframes for complex motions produce wrong-looking interpolations. Sample-count heuristics now in the Import section above.
5. **Animations need an implicit frame 0.** If user authors an animation starting at t=0.5s, prepend frame 0 = current bone state so it doesn't snap.
6. **Virtual list entries beat stateful "system" entries.** Initial Position anchor lives in render-time computed `displayedAnchors`, not React state. Eliminated a race condition between fetch hydrate + editor-ready probe.
7. **Dev-only Vite middleware is the cheap way to read/write JSON from the browser** during local dev. `configureServer` + `app.use` + check `req.url`. Won't survive prod build — fine for an author-time tool.
8. **3-frame imports of complex baked animations look broken.** Not a bug — slerp limitation. 5+ is the user's working minimum for sword_atk01.
9. **Bone-translation scope must be an allow-list, not a free-for-all.** `POSITION_BONES = ['Hips', 'Hand.L', 'Hand.R', 'Foot.L', 'Foot.R']` gates `translateSelectedBone` so dragging a Lower Arm bone can't stretch the forearm — only end-effectors and Hips run IK. UI auto-shows the TRANSLATE section for any listed bone.
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
21. **GLB-loaded skeletons in Babylon have a negative Y scale somewhere up the parent chain** (Z-up Blender → Y-up glTF conversion). Anything you do that requires "extract rotation from world matrix" via `Matrix.decompose` returns garbage. Avoid the world matrix for rotation work entirely — use position-only matrix transforms (which handle scale fine) or compose rotation quaternions through the parent chain manually.
22. **`Bone.setRotationQuaternion(quat, Space.WORLD)` is a trap for GLB-driven rigs.** The bone's "source of truth" is the linked TransformNode; the Bone API writes are silently overwritten on the next `skeleton.prepare()`. Always operate on `bone._linkedTransformNode` directly.
23. **Setter vs mutation on `node.rotationQuaternion`.** `node.rotationQuaternion = newQ` marks dirty; `node.rotationQuaternion.copyFrom(newQ)` does NOT and the new rotation never renders. Same for position.
24. **Bone "down-the-bone" axis is NOT a universal `(0,-1,0)`.** It's whatever direction the child bone sits in this bone's local space — read it from `childNode.position.normalize()`. Hard-coding the axis works for trivial rigs and silently breaks for production ones.
25. **Shortest-arc rotation kills twist.** Naive `rotationFromTo(currentDir, newDir)` re-aims the bone but randomizes its twist around its own length axis, which looks like the bone "rolling" sideways. Solution: anchor to the bone's REST local rotation and add only a swing delta in parent-local space. Then twist stays consistent.
26. **For IK position-based application, transform the TARGET into parent-local space, not the rotation.** `parent.getWorldMatrix().invert() * worldPos` works under any scale/mirror. Then compute desired direction in parent-local and build the local rotation from that. Avoids decompose entirely.
27. **Playwright diagnostic script per subsystem.** `scripts/qa-knight.mjs` for baseline screenshots; `scripts/qa-ik-diagnose.mjs` for IK foot-drift measurement with internal logging via `window.__ikDebug = true`. When iterating on math-heavy systems, having a script that hits the dev server and dumps numerical state in 10 seconds beats hand-testing in the browser every time.
28. **In-engine diagnostic helpers belong on `window.__editor`.** `debugBoneWorld(name)` reads from the ACTIVE editor model (not whichever same-named bone Babylon found first). When the scene has multiple instances of the same rig (hero + opp + Model 1 + Model 2 = 4 Hips bones), `scene.getTransformNodeByName('Hips')` returns the wrong one. Always plumb diagnostics through the engine-side API that knows about model identity.

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

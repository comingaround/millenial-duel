import { CSSProperties, useEffect, useState } from 'react'

type RotationMap = Record<string, [number, number, number, number]>
type PositionMap = Record<string, [number, number, number]>

type Pose = {
  id: string
  name: string
  rotations: RotationMap
  positions?: PositionMap
  system?: boolean
}
type Anchor = {
  id: string; name: string; rotations: RotationMap; positions?: PositionMap; system?: boolean
}

// Per-keyframe body displacement from anim-start position (metres).
// Defines world-space character locomotion alongside the bone pose. When
// the animation plays, the character's root translates so it's at this
// displacement at this keyframe's time.
type AnimKeyframe = {
  anchorId: string
  time: number
  displacement?: [number, number, number]
}
type AnimDef = {
  id: string
  name: string
  // Starting pose the model snaps to before keyframes play. Allows the
  // animation to begin from a known state (e.g. "Initial Position" or a
  // saved windup pose) regardless of where the model currently is.
  initialPoseId?: string
  keyframes: AnimKeyframe[]
  heroKey?: string
  oppKey?: string
}

type DraftAnim = {
  name: string
  initialPoseId?: string
  keyframes: AnimKeyframe[]
  editingId?: string
}

type EditorApi = {
  snapshot: (name: string) => Pose
  apply: (pose: { rotations: RotationMap; positions?: PositionMap }) => void
  reset: () => void
  selectBone: (name: string | null) => void
  getSelectedBone: () => string | null
  addBoneSelectListener: (cb: (name: string | null) => void) => () => void
  playAnimation: (
    keyframes: Array<{ anchor: { rotations: RotationMap; positions?: PositionMap }; time: number }>,
  ) => void
  stopAnimation: () => void
  pushUndo: () => void
  undo: () => boolean
  redo: () => boolean
  getInitialAnchor: () => Anchor
  listBakedAnimations?: () => Array<{ name: string; from: number; to: number }>
  importBakedAnimation?: (
    animName: string,
    sampleCount?: number,
  ) => {
    anchors: Array<{ name: string; rotations: RotationMap; positions?: PositionMap }>
    durations: number[]
  } | null
}

declare global {
  interface Window {
    __editor?: EditorApi
  }
}

export default function EditorPanel() {
  const [selectedBone, setSelectedBone] = useState<string | null>(null)
  const [poses, setPoses] = useState<Pose[]>([])
  const [anchors, setAnchors] = useState<Anchor[]>([])
  // Multi-model selector — both knights are on screen at all times; the
  // active index decides which one bone-control / anim-preview affects.
  const [models, setModels] = useState<string[]>([])
  const [modelVisibilities, setModelVisibilities] = useState<Record<number, boolean>>({})
  const [activeModel, setActiveModelState] = useState(0)
  // Which model the editor camera is currently focused on. -1 = none
  // (initial state, target is the static centre). Updates via engine
  // listener so other paths that set focus also light up the icon.
  const [focusedModel, setFocusedModel] = useState(-1)
  const setActiveModel = (idx: number) => {
    setActiveModelState(idx)
    ;(window as any).__editor?.setActiveModel?.(idx)
  }
  // Model-edit modal: null when closed
  const [editingModel, setEditingModel] = useState<{
    idx: number
    name: string
    visible: boolean
  } | null>(null)
  // Sync-play: which anim to fire on each model when "Play both" is clicked
  // Sync-play session — user explicitly opts models in, then defines
  // synchronized "steps" where each model picks an anim. All anims in
  // a step fire at t=0 of that step; next step starts after the
  // longest anim in the current step finishes.
  const [syncModels, setSyncModels] = useState<number[]>([])
  const [syncSteps, setSyncSteps] = useState<Array<{ id: string; anims: Record<number, string> }>>([])
  const [animations, setAnimations] = useState<AnimDef[]>([])
  const [draft, setDraft] = useState<DraftAnim | null>(null)
  const [hydrated, setHydrated] = useState(false)
  // Set only when (a) library.json was loaded with schemaVersion=2 OR
  // (b) we successfully ran the v1→v3 retarget pass during hydration.
  // Save effect writes `schemaVersion: 2` ONLY when this is true — so a
  // failed/skipped retarget never poisons the file with a "no retarget
  // needed" marker on unretargeted data.
  const [libraryRetargeted, setLibraryRetargeted] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
  // Bumped by the engine when any Custom slot mutates. Used as a save
  // effect dep so persistence fires on every slot toggle. Slot state lives
  // on the engine (Custom model's customSlots field), not in React state.
  const [customSlotsRev, setCustomSlotsRev] = useState(0)
  // SAVED material snapshot for the Style tab. Keyed by model name → slot
  // → hex. Mutated only by the Save button (live colour drags do NOT
  // touch this), so Revert can re-apply this exact state and the
  // auto-save loop only writes to disk on explicit Save.
  const [editorMaterials, setEditorMaterials] = useState<Record<string, Record<string, string>>>({})
  // Import-baked-animation modal
  const [importOpen, setImportOpen] = useState(false)
  const [bakedList, setBakedList] = useState<Array<{ name: string; from: number; to: number }>>([])
  const [importPick, setImportPick] = useState<string>('')
  const [importMode, setImportMode] = useState<'original' | 'custom'>('original')
  const [importCount, setImportCount] = useState(8)

  // Load saved library from disk (dev plugin endpoint), then attach to editor
  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false

    // Wait for the editor's rest pose to be available, then run an
    // optional one-time retarget. Library.json from before the v3-knight
    // swap was authored against the old rig's rest, so the same
    // absolute local rotations and Hips positions look wrong on v3
    // ("hero sinks under the ground"). Math:
    //   delta = inv(restOld) * absoluteOld
    //   absoluteV3 = restV3 * delta
    // For positions: pos_v3 = restV3.pos + (pos_old - restOld.pos).
    const retargetAnchorOnce = (a: Anchor, oldRest: { rotations: RotationMap; positions: PositionMap }, newRest: { rotations: RotationMap; positions: PositionMap }): Anchor => {
      const rotations: RotationMap = {}
      for (const [bone, q] of Object.entries(a.rotations)) {
        const qOld = oldRest.rotations[bone]
        const qNew = newRest.rotations[bone]
        if (!qOld || !qNew) { rotations[bone] = q; continue }
        // delta = inv(qOld) * q
        const inv: [number, number, number, number] = [-qOld[0], -qOld[1], -qOld[2], qOld[3]]
        const ax=inv[0], ay=inv[1], az=inv[2], aw=inv[3]
        const bx=q[0], by=q[1], bz=q[2], bw=q[3]
        const dx = aw*bx + ax*bw + ay*bz - az*by
        const dy = aw*by - ax*bz + ay*bw + az*bx
        const dz = aw*bz + ax*by - ay*bx + az*bw
        const dw = aw*bw - ax*bx - ay*by - az*bz
        // result = qNew * delta
        const cx=qNew[0], cy=qNew[1], cz=qNew[2], cw=qNew[3]
        rotations[bone] = [
          cw*dx + cx*dw + cy*dz - cz*dy,
          cw*dy - cx*dz + cy*dw + cz*dx,
          cw*dz + cx*dy - cy*dx + cz*dw,
          cw*dw - cx*dx - cy*dy - cz*dz,
        ]
      }
      const positions = a.positions ? Object.fromEntries(
        Object.entries(a.positions).map(([bone, p]) => {
          const oldP = oldRest.positions[bone]
          const newP = newRest.positions[bone]
          if (!oldP || !newP) return [bone, p]
          return [bone, [
            newP[0] + p[0] - oldP[0],
            newP[1] + p[1] - oldP[1],
            newP[2] + p[2] - oldP[2],
          ] as [number, number, number]]
        })
      ) : undefined
      return { ...a, rotations, positions }
    }

    const applyLibrary = (data: any) => {
      const needsRetarget = data.schemaVersion !== 2
      const ed = (window as any).__editor
      const legacy = ed?.getLegacyRestPose?.()
      const currentRest = ed?.getInitialAnchor?.()
      const canRetarget = needsRetarget && legacy && currentRest
      const transform = canRetarget
        ? (a: Anchor) => retargetAnchorOnce(a, legacy, currentRest)
        : (a: Anchor) => a
      if (Array.isArray(data.poses)) setPoses(data.poses.map(transform))
      if (Array.isArray(data.anchors))
        setAnchors(data.anchors.filter((a: Anchor) => !a.system).map(transform))
      if (Array.isArray(data.animations)) setAnimations(data.animations)
      // Mark retargeted ONLY when (a) source already had v2 marker OR
      // (b) we just successfully ran the retarget. Skip-because-of-
      // missing-legacy must NOT poison the file.
      if (!needsRetarget) setLibraryRetargeted(true)
      else if (canRetarget) {
        setLibraryRetargeted(true)
        // eslint-disable-next-line no-console
        console.log(`[retarget] applied v1→v3 retarget to ${(data.poses?.length ?? 0)} pose(s) + ${(data.anchors?.length ?? 0)} anchor(s); next save will mark schemaVersion=2`)
      } else {
        // eslint-disable-next-line no-console
        console.warn('[retarget] needed but legacy rest pose unavailable — data loaded AS-IS, schemaVersion will NOT be written until a retarget succeeds')
      }
    }

    const hydrate = async () => {
      try {
        const res = await fetch('/api/animations')
        if (res.ok) {
          const data = await res.json()
          if (cancelled) return
          // If retarget is needed AND legacy rest pose isn't loaded yet,
          // wait for it (engine init is async — same poll pattern as the
          // customSlots hydrate below).
          const needsRetarget = data.schemaVersion !== 2
          if (needsRetarget) {
            const ready = () => {
              const ed = (window as any).__editor
              return !!(ed?.getLegacyRestPose && ed?.getInitialAnchor?.())
            }
            if (!ready()) {
              await new Promise<void>((resolve) => {
                const iv = setInterval(() => {
                  if (ready() || cancelled) { clearInterval(iv); resolve() }
                }, 200)
                setTimeout(() => { clearInterval(iv); resolve() }, 15000)
              })
            }
            if (cancelled) return
          }
          applyLibrary(data)
          // Custom slots — hydrate the Custom model. Wait for the editor
          // API to be ready (createEditorScene is async); poll with a
          // short retry. Fires on the engine side, not React state.
          if (data.customSlots && typeof data.customSlots === 'object') {
            const tryApply = () => {
              const ed = (window as any).__editor
              if (ed?.setCustomSlots) {
                ed.setCustomSlots(data.customSlots)
                return true
              }
              return false
            }
            if (!tryApply()) {
              const iv = setInterval(() => {
                if (tryApply()) clearInterval(iv)
              }, 200)
              setTimeout(() => clearInterval(iv), 10000)
            }
          }
          // Editor materials snapshot — same engine-ready polling
          // pattern. Push into the live matCache AND seed the engine's
          // saved-snapshot store (so Revert works without first Save'ing)
          // AND mirror into React state for the auto-save loop.
          if (data.editorMaterials && typeof data.editorMaterials === 'object') {
            setEditorMaterials(data.editorMaterials)
            const tryApplyMats = () => {
              const ed = (window as any).__editor
              if (ed?.applyEditorMaterials && ed?.setSavedEditorMaterials) {
                ed.applyEditorMaterials(data.editorMaterials)
                ed.setSavedEditorMaterials(data.editorMaterials)
                return true
              }
              return false
            }
            if (!tryApplyMats()) {
              const iv = setInterval(() => {
                if (tryApplyMats()) clearInterval(iv)
              }, 200)
              setTimeout(() => clearInterval(iv), 10000)
            }
          }
        }
      } catch {
        // No persistence endpoint (e.g. production build) — silent
      }
      setHydrated(true)
    }
    hydrate()

    let unsubSlots: (() => void) | null = null
    let unsubModels: (() => void) | null = null
    let unsubFocus: (() => void) | null = null
    let unsubEditorMats: (() => void) | null = null
    const tryAttach = () => {
      const ed = window.__editor
      if (!ed) return false
      unsub = ed.addBoneSelectListener((name) => setSelectedBone(name))
      setSelectedBone(ed.getSelectedBone())
      const pullModels = () => {
        const mNames = (ed as any).getModels?.() as string[] | undefined
        if (mNames) setModels(mNames)
      }
      pullModels()
      const aIdx = (ed as any).getActiveModelIndex?.() as number | undefined
      if (typeof aIdx === 'number') setActiveModelState(aIdx)
      // Subscribe to Custom slot mutations → bump local rev → trigger save effect.
      unsubSlots = (ed as any).addCustomSlotsListener?.(() => {
        setCustomSlotsRev((r) => r + 1)
      }) ?? null
      // Re-pull names + visibilities when a model is spawned at runtime.
      unsubModels = (ed as any).addModelsChangeListener?.(pullModels) ?? null
      // Track camera focus so the per-row 🎯 icon can highlight.
      const initialFocus = (ed as any).getFocusedModelIdx?.()
      if (typeof initialFocus === 'number') setFocusedModel(initialFocus)
      unsubFocus = (ed as any).addFocusChangeListener?.(() => {
        const i = (ed as any).getFocusedModelIdx?.()
        if (typeof i === 'number') setFocusedModel(i)
      }) ?? null
      // Subscribe to Style Save events — mirror engine snapshot into
      // React state so the auto-save loop persists it to library.json.
      unsubEditorMats = (ed as any).addEditorMaterialsListener?.(() => {
        const snap = (ed as any).getSavedEditorMaterials?.() ?? {}
        setEditorMaterials({ ...snap })
      }) ?? null
      setEditorReady(true)
      return true
    }
    if (!tryAttach()) {
      const i = setInterval(() => {
        if (tryAttach()) clearInterval(i)
      }, 200)
      return () => {
        cancelled = true
        clearInterval(i)
        unsub?.()
        unsubSlots?.()
        unsubModels?.()
        unsubFocus?.()
        unsubEditorMats?.()
      }
    }
    return () => {
      cancelled = true
      unsub?.()
      unsubSlots?.()
      unsubModels?.()
      unsubFocus?.()
      unsubEditorMats?.()
    }
  }, [])

  // Initial anchor is virtual — always available, never stored in state.
  // Recomputed when editor becomes ready.
  const initialAnchor: Anchor | null = editorReady
    ? window.__editor?.getInitialAnchor?.() ?? null
    : null
  const displayedAnchors: Anchor[] = initialAnchor
    ? [initialAnchor, ...anchors]
    : anchors

  // Initial pose is the same idea — virtual, same data as the initial
  // anchor, shown at the top of the Poses list.
  const initialPose: Pose | null = initialAnchor
    ? {
        id: '__initial_pose__',
        name: 'Initial Position',
        rotations: initialAnchor.rotations,
        system: true,
      }
    : null
  const displayedPoses: Pose[] = initialPose ? [initialPose, ...poses] : poses

  // Persist library to disk on every change (debounced 500ms). Skip during
  // initial hydration so we don't immediately overwrite the loaded data
  // with the empty default state.
  useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => {
      // Pull live Custom slot state from engine — it's not in React state,
      // it lives on the Custom model directly.
      const customSlots = (window as any).__editor?.getCustomSlots?.() ?? null
      const payload: Record<string, unknown> = {
        poses,
        anchors: anchors.filter((a) => !a.system), // skip Initial position
        animations,
      }
      if (customSlots) payload.customSlots = customSlots
      if (Object.keys(editorMaterials).length > 0) payload.editorMaterials = editorMaterials
      // Only write the v2 marker AFTER a successful retarget (or if data
      // came in already marked). A skipped retarget must not poison the
      // file with a false-positive marker — without the marker, next
      // load will retry.
      if (libraryRetargeted) payload.schemaVersion = 2
      fetch('/api/animations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload, null, 2),
      }).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [poses, anchors, animations, hydrated, customSlotsRev, libraryRetargeted, editorMaterials])

  // Expose resolved animations to window so engine.ts can dispatch keys
  useEffect(() => {
    const allPoses = (initialPose ? [initialPose, ...poses] : poses)
    const resolved = animations.map((a) => {
      const initialPoseData = a.initialPoseId
        ? allPoses.find((p) => p.id === a.initialPoseId)
        : null
      return {
        ...a,
        initialPose: initialPoseData
          ? { rotations: initialPoseData.rotations, positions: initialPoseData.positions }
          : null,
        resolved: a.keyframes
          .map((kf) => {
            const an = displayedAnchors.find((x) => x.id === kf.anchorId)
            return an
              ? {
                  anchor: { rotations: an.rotations, positions: an.positions },
                  time: kf.time,
                  displacement: kf.displacement,
                }
              : null
          })
          .filter((x) => x !== null) as Array<{
            anchor: { rotations: RotationMap; positions?: PositionMap }
            time: number
            displacement?: [number, number, number]
          }>,
      }
    })
    ;(window as any).__customAnims = resolved
  }, [animations, anchors, poses, editorReady])

  const onOpenImport = () => {
    const ed = window.__editor
    if (!ed?.listBakedAnimations) return
    const list = ed.listBakedAnimations()
    if (list.length === 0) {
      alert('No baked animations available.')
      return
    }
    setBakedList(list)
    setImportPick(list[0].name)
    setImportOpen(true)
  }

  const onConfirmImport = () => {
    const ed = window.__editor
    if (!ed?.importBakedAnimation) return
    const sampleCount = importMode === 'original' ? 0 : Math.max(2, Math.min(30, importCount))
    const result = ed.importBakedAnimation(importPick, sampleCount)
    if (!result) {
      alert('Animation not found.')
      return
    }
    const newAnchors: Anchor[] = result.anchors.map((a) => ({
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID() : `anch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: a.name,
      rotations: a.rotations,
      positions: a.positions,
    }))
    setAnchors((curr) => [...curr, ...newAnchors])

    const animKeyframes: AnimKeyframe[] = newAnchors.map((a, i) => ({
      anchorId: a.id,
      time: +result.durations[i].toFixed(3),
    }))
    const cleanName = importPick.replace(/^Armature\|/, '')
    const animDef: AnimDef = {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID() : `anim_${Date.now()}`,
      name: `${cleanName} (imported)`,
      keyframes: animKeyframes,
    }
    setAnimations((curr) => [...curr, animDef])
    setImportOpen(false)
  }

  const onSavePose = () => {
    const ed = window.__editor
    if (!ed) return
    const name = window.prompt('Pose name:', `Pose ${poses.length + 1}`)
    if (!name) return
    const snap = ed.snapshot(name)
    setPoses((p) => [...p, snap])
  }

  const onSaveAnchor = () => {
    const ed = window.__editor
    if (!ed) return
    const name = window.prompt('Anchor name:', `Anchor ${anchors.length + 1}`)
    if (!name) return
    const snap = ed.snapshot(name)
    setAnchors((a) => [...a, snap])
  }

  const onApplyPose = (p: Pose) => {
    window.__editor?.pushUndo()
    window.__editor?.apply(p)
  }
  const onApplyAnchor = (a: Anchor) => {
    window.__editor?.pushUndo()
    window.__editor?.apply(a)
  }

  const onDeletePose = (id: string) => setPoses((p) => p.filter((x) => x.id !== id))
  const onDeleteAnchor = (id: string) =>
    setAnchors((a) => a.filter((x) => x.id !== id || x.system))

  const onRenamePose = (id: string, newName: string) =>
    setPoses((p) => p.map((x) => (x.id === id ? { ...x, name: newName } : x)))
  const onRenameAnchor = (id: string, newName: string) =>
    setAnchors((a) => a.map((x) => (x.id === id ? { ...x, name: newName } : x)))
  // Edit = load the full animation into the draft builder so the user can
  // tweak name + keyframe anchors + timing without re-creating from scratch.
  // Save commits in place (no duplicate). Cancel discards edits.
  const onEditAnimation = (anim: AnimDef) => {
    setDraft({
      name: anim.name,
      initialPoseId: anim.initialPoseId,
      keyframes: anim.keyframes.map((k) => ({ ...k })),
      editingId: anim.id,
    })
  }

  const promptRename = (currentName: string, apply: (next: string) => void) => () => {
    const next = window.prompt('Rename to:', currentName)
    if (!next) return
    const trimmed = next.trim()
    if (!trimmed) return
    apply(trimmed)
  }
  const onDeleteAnimation = (id: string) =>
    setAnimations((a) => a.filter((x) => x.id !== id))

  // --- Animation builder ---

  const onNewAnimation = () => {
    if (displayedAnchors.length < 1) {
      alert('No anchors available yet.')
      return
    }
    setDraft({
      name: `Animation ${animations.length + 1}`,
      keyframes: [],
    })
  }

  const onAddKeyframe = () => {
    if (!draft) return
    const first = displayedAnchors[0]
    if (!first) return
    const lastTime = draft.keyframes[draft.keyframes.length - 1]?.time ?? 0
    setDraft({
      ...draft,
      keyframes: [
        ...draft.keyframes,
        { anchorId: first.id, time: +(lastTime + 0.3).toFixed(2) },
      ],
    })
  }

  const onUpdateKeyframe = (idx: number, updates: Partial<AnimKeyframe>) => {
    if (!draft) return
    setDraft({
      ...draft,
      keyframes: draft.keyframes.map((k, i) => (i === idx ? { ...k, ...updates } : k)),
    })
  }

  const onRemoveKeyframe = (idx: number) => {
    if (!draft) return
    setDraft({
      ...draft,
      keyframes: draft.keyframes.filter((_, i) => i !== idx),
    })
  }

  const resolveKeyframes = (kfs: AnimKeyframe[]) =>
    kfs
      .map((kf) => {
        const anchor = displayedAnchors.find((a) => a.id === kf.anchorId)
        return anchor
          ? {
              anchor: { rotations: anchor.rotations, positions: anchor.positions },
              time: kf.time,
              displacement: kf.displacement,
            }
          : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

  // Look up a pose by id from displayed list (handles both user and system).
  const findPose = (id?: string): Pose | undefined =>
    id ? displayedPoses.find((p) => p.id === id) : undefined

  // ─── Mirror L↔R helpers ───
  // The knight's rest pose is ASYMMETRIC (artist baked in stance offsets:
  // weight-shift, foot rotation, etc — Upper Leg.L vs mirror(Upper Leg.R)
  // diverges by up to 1.9 in quaternion components). So a naive
  // "mirror absolute rotation" formula produces garbage. The correct
  // approach is delta-based:
  //   delta_R = inv(rest_R) ⊗ pose_R          (R's rotation away from its rest)
  //   mirror_d = (x, -y, -z, w) of delta_R    (reflect the delta across YZ)
  //   pose_L  = rest_L ⊗ mirror_d             (apply mirrored delta to L's rest)
  // Same formula works for midline bones (Hips/Spine/etc) since rest_R
  // and rest_L collapse to the same value when bone name doesn't change.
  const mirrorBoneName = (name: string): string => {
    if (name.endsWith('.L')) return name.slice(0, -2) + '.R'
    if (name.endsWith('.R')) return name.slice(0, -2) + '.L'
    return name
  }
  // Unit-quaternion ops on plain [x,y,z,w] arrays so we don't need a
  // Babylon dependency in this React file.
  const qInv = (q: [number, number, number, number]): [number, number, number, number] =>
    [-q[0], -q[1], -q[2], q[3]]
  const qMul = (
    a: [number, number, number, number],
    b: [number, number, number, number],
  ): [number, number, number, number] => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
  const mirrorRotations = (r: RotationMap, rest: RotationMap): RotationMap => {
    const out: RotationMap = {}
    for (const [bone, q] of Object.entries(r)) {
      const targetBone = mirrorBoneName(bone)
      const restSource = rest[bone]
      const restTarget = rest[targetBone]
      if (!restSource || !restTarget) {
        // Bone not in rest data — fall back to naive mirror so we
        // produce SOMETHING, but log so it's debuggable.
        // eslint-disable-next-line no-console
        console.warn(`[mirror] missing rest data for '${bone}' or '${targetBone}'; using naive mirror`)
        out[targetBone] = [q[0], -q[1], -q[2], q[3]]
        continue
      }
      // delta in source-bone's rest frame
      const delta = qMul(qInv(restSource), q)
      // reflect delta across YZ plane
      const mirrored: [number, number, number, number] = [delta[0], -delta[1], -delta[2], delta[3]]
      // re-apply on the target bone's rest
      out[targetBone] = qMul(restTarget, mirrored)
    }
    return out
  }
  const mirrorPositions = (p?: PositionMap): PositionMap | undefined => {
    if (!p) return undefined
    const out: PositionMap = {}
    for (const [bone, pos] of Object.entries(p)) {
      out[mirrorBoneName(bone)] = [-pos[0], pos[1], pos[2]]
    }
    return out
  }
  const mirrorDisplacement = (
    d?: [number, number, number],
  ): [number, number, number] | undefined => {
    if (!d) return undefined
    return [-d[0], d[1], d[2]]
  }

  // Create a mirrored copy of an animation — clones every non-system
  // anchor it references with L↔R-flipped rotations + positions, builds
  // a new AnimDef referencing the new anchors. Persists via existing
  // debounced save effect.
  // TODO: when non-symmetric initial poses are authored, also mirror the
  // referenced pose. For now Initial Position is bilaterally symmetric.
  // Shared by all mirror handlers — pulls rest pose (active editor model;
  // identical across all knights since they share the GLB) needed for
  // delta-based mirroring against an asymmetric rig.
  const getRestRotations = (): RotationMap => {
    const restAnchor = (window as any).__editor?.getInitialAnchor?.() as Anchor | null
    if (!restAnchor) {
      // eslint-disable-next-line no-console
      console.warn('[mirror] no rest pose available — mirror will be incorrect for this asymmetric rig')
      return {}
    }
    return restAnchor.rotations
  }
  const newMirrorId = (prefix: 'anch' | 'anim' | 'pose' = 'anch') =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

  const onMirrorPose = (poseId: string) => {
    const src = displayedPoses.find((p) => p.id === poseId)
    if (!src || src.system) return
    const rest = getRestRotations()
    const newPose: Pose = {
      id: newMirrorId('pose'),
      name: `${src.name} (mirrored)`,
      rotations: mirrorRotations(src.rotations, rest),
      positions: mirrorPositions(src.positions),
    }
    setPoses((curr) => [...curr, newPose])
  }
  const onMirrorAnchor = (anchorId: string) => {
    const src = displayedAnchors.find((a) => a.id === anchorId)
    if (!src || src.system) return
    const rest = getRestRotations()
    const newAnchor: Anchor = {
      id: newMirrorId('anch'),
      name: `${src.name} (mirrored)`,
      rotations: mirrorRotations(src.rotations, rest),
      positions: mirrorPositions(src.positions),
    }
    setAnchors((curr) => [...curr, newAnchor])
  }

  const onMirrorAnimation = (animId: string) => {
    const orig = animations.find((a) => a.id === animId)
    if (!orig) return
    const rest = getRestRotations()
    const newId = (p: 'anch' | 'anim' = 'anch') => newMirrorId(p)
    const anchorIdMap = new Map<string, string>()
    const newAnchors: Anchor[] = []
    for (const kf of orig.keyframes) {
      if (anchorIdMap.has(kf.anchorId)) continue
      const src = displayedAnchors.find((a) => a.id === kf.anchorId)
      if (!src) continue
      // System anchors (e.g. "Initial Position" — the rest pose) are
      // their own mirror by definition (the rest pose mirrors to itself
      // in delta math because delta=identity); keep references as-is.
      if (src.system) continue
      const id = newId()
      newAnchors.push({
        id,
        name: `${src.name} (mirrored)`,
        rotations: mirrorRotations(src.rotations, rest),
        positions: mirrorPositions(src.positions),
      })
      anchorIdMap.set(src.id, id)
    }
    const newAnim: AnimDef = {
      id: newId('anim'),
      name: `${orig.name} (mirrored)`,
      initialPoseId: orig.initialPoseId,
      keyframes: orig.keyframes.map((kf) => ({
        anchorId: anchorIdMap.get(kf.anchorId) ?? kf.anchorId,
        time: kf.time,
        displacement: mirrorDisplacement(kf.displacement),
      })),
      // heroKey / oppKey intentionally NOT carried over — avoids key
      // collision with the original; user binds explicitly.
    }
    setAnchors((curr) => [...curr, ...newAnchors])
    setAnimations((curr) => [...curr, newAnim])
  }

  const onPreviewDraft = () => {
    if (!draft) return
    const resolved = resolveKeyframes(draft.keyframes)
    if (resolved.length < 2) {
      alert('Need at least 2 keyframes to preview.')
      return
    }
    // Snap to initial pose first so the animation always starts from a
    // known state regardless of where the model currently is.
    const initial = findPose(draft.initialPoseId)
    if (initial) window.__editor?.apply(initial)
    window.__editor?.playAnimation(resolved)
  }

  const onSaveDraft = () => {
    if (!draft) return
    if (draft.keyframes.length < 2) {
      alert('Need at least 2 keyframes.')
      return
    }
    if (draft.editingId) {
      const editingId = draft.editingId
      setAnimations((curr) =>
        curr.map((x) =>
          x.id === editingId
            ? {
                ...x,
                name: draft.name,
                initialPoseId: draft.initialPoseId,
                keyframes: draft.keyframes,
              }
            : x,
        ),
      )
    } else {
      const newAnim: AnimDef = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `anim_${Date.now()}`,
        name: draft.name,
        initialPoseId: draft.initialPoseId,
        keyframes: draft.keyframes,
      }
      setAnimations((a) => [...a, newAnim])
    }
    setDraft(null)
  }

  const onPlayAnimation = (anim: AnimDef) => {
    const resolved = resolveKeyframes(anim.keyframes)
    if (resolved.length < 2) return
    const initial = findPose(anim.initialPoseId)
    if (initial) window.__editor?.apply(initial)
    window.__editor?.playAnimation(resolved)
  }

  // Sync-play: run a multi-step sequence. Each step fires its anims on
  // all participating models simultaneously; next step starts after the
  // longest anim in the current step finishes. No cancellation — fire
  // again and animations overlap; use Reset to recover.
  const onPlaySync = () => {
    const ed = window.__editor as any
    let cumulativeMs = 0
    for (const step of syncSteps) {
      let maxDurS = 0
      // Pass 1: compute step duration so timing is independent of fire order.
      for (const modelIdx of syncModels) {
        const animId = step.anims[modelIdx]
        if (!animId) continue
        const anim = animations.find((a) => a.id === animId)
        if (!anim) continue
        const resolved = resolveKeyframes(anim.keyframes)
        if (resolved.length < 2) continue
        const lastT = resolved[resolved.length - 1].time
        if (lastT > maxDurS) maxDurS = lastT
      }
      // Pass 2: schedule each model's anim at the step's start moment.
      const startAt = cumulativeMs
      for (const modelIdx of syncModels) {
        const animId = step.anims[modelIdx]
        if (!animId) continue
        const anim = animations.find((a) => a.id === animId)
        if (!anim) continue
        const resolved = resolveKeyframes(anim.keyframes)
        if (resolved.length < 2) continue
        const initial = findPose(anim.initialPoseId)
        const initialPose = initial
          ? { rotations: initial.rotations, positions: initial.positions }
          : undefined
        setTimeout(() => {
          ed?.playAnimationOnModel?.(modelIdx, resolved, initialPose)
        }, startAt)
      }
      cumulativeMs += maxDurS * 1000
    }
  }
  // Sync-play state mutators.
  const addSyncModel = (idx: number) => {
    setSyncModels((curr) => (curr.includes(idx) ? curr : [...curr, idx]))
  }
  const removeSyncModel = (idx: number) => {
    setSyncModels((curr) => curr.filter((i) => i !== idx))
    setSyncSteps((curr) =>
      curr.map((s) => {
        const next = { ...s.anims }
        delete next[idx]
        return { ...s, anims: next }
      }),
    )
  }
  const addSyncStep = () => {
    setSyncSteps((curr) => [
      ...curr,
      { id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, anims: {} },
    ])
  }
  const removeSyncStep = (stepId: string) => {
    setSyncSteps((curr) => curr.filter((s) => s.id !== stepId))
  }
  const setStepAnim = (stepId: string, modelIdx: number, animId: string) => {
    setSyncSteps((curr) =>
      curr.map((s) =>
        s.id !== stepId ? s : { ...s, anims: { ...s.anims, [modelIdx]: animId } },
      ),
    )
  }

  return (
    <div style={panelStyle}>
      <h3 style={titleStyle}>EDITOR</h3>

      {/* Models — knights are always on screen; click to choose which
          one bone-control / animation preview operates on. Click + to
          spawn another, click 👁/🚫 to toggle visibility in-place. */}
      <Section
        label={`Models (${models.length})`}
        action={
          <button
            style={sectionPlusBtnStyle}
            title="Add a new knight (visible)"
            onClick={async () => {
              const ed = (window as any).__editor
              const newIdx = await ed?.addModel?.()
              if (typeof newIdx === 'number') setActiveModel(newIdx)
            }}
          >
            +
          </button>
        }
      >
        {models.length === 0 ? (
          <Empty text="(loading…)" />
        ) : (
          models.map((name, idx) => (
            <ModelRow
              key={idx}
              name={name}
              active={activeModel === idx}
              hidden={modelVisibilities[idx] === false}
              focused={focusedModel === idx}
              onClick={() => setActiveModel(idx)}
              onToggleHidden={() => {
                const nextVisible = !(modelVisibilities[idx] !== false)
                ;(window as any).__editor?.setModelVisible?.(idx, nextVisible)
                setModelVisibilities((curr) => ({ ...curr, [idx]: nextVisible }))
              }}
              onFocus={() => (window as any).__editor?.focusModel?.(idx)}
              onEdit={() =>
                setEditingModel({
                  idx,
                  name,
                  visible: modelVisibilities[idx] !== false,
                })
              }
            />
          ))
        )}
      </Section>

      {/* Save buttons */}
      <div style={btnRowStyle}>
        <button style={btnPrimary} onClick={onSavePose}>Save Pose</button>
        <button style={btnSecondary} onClick={onSaveAnchor}>Save Anchor</button>
      </div>
      <button style={{ ...btnPrimary, width: '100%', marginBottom: 14, background: 'rgba(150, 110, 60, 0.55)' }} onClick={onOpenImport}>
        ⬇ Import baked animation
      </button>

      {/* Poses */}
      <Section label={`Poses (${displayedPoses.length})`}>
        {displayedPoses.length === 0 ? (
          <Empty text="(none)" />
        ) : (
          displayedPoses.map((p) => (
            <ListRow
              key={p.id}
              name={p.name}
              onClick={() => onApplyPose(p)}
              onDelete={p.system ? undefined : () => onDeletePose(p.id)}
              onRename={p.system ? undefined : promptRename(p.name, (n) => onRenamePose(p.id, n))}
              onMirror={p.system ? undefined : () => onMirrorPose(p.id)}
            />
          ))
        )}
      </Section>

      {/* Anchors */}
      <Section label={`Anchors (${displayedAnchors.length})`}>
        {displayedAnchors.length === 0 ? (
          <Empty text="(save anchors to build animations)" />
        ) : (
          displayedAnchors.map((a) => (
            <ListRow
              key={a.id}
              name={a.name}
              onClick={() => onApplyAnchor(a)}
              onDelete={a.system ? undefined : () => onDeleteAnchor(a.id)}
              onRename={a.system ? undefined : promptRename(a.name, (n) => onRenameAnchor(a.id, n))}
              onMirror={a.system ? undefined : () => onMirrorAnchor(a.id)}
            />
          ))
        )}
      </Section>

      {/* Animation builder */}
      {draft ? (
        <div style={builderStyle}>
          <div style={labelStyle}>{draft.editingId ? 'Edit Animation' : 'New Animation'}</div>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            style={inputStyle}
          />
          <div style={{ ...labelStyle, marginTop: 8 }}>Initial pose (before keyframes)</div>
          <select
            value={draft.initialPoseId ?? ''}
            onChange={(e) =>
              setDraft({ ...draft, initialPoseId: e.target.value || undefined })
            }
            style={selectStyle}
          >
            <option value="" style={{ background: '#1c1f24', color: '#fff' }}>
              (none — start from current)
            </option>
            {displayedPoses.map((p) => (
              <option key={p.id} value={p.id} style={{ background: '#1c1f24', color: '#fff' }}>
                {p.name}
              </option>
            ))}
          </select>
          <div style={{ ...labelStyle, marginTop: 8 }}>Keyframes</div>
          {draft.keyframes.length === 0 ? (
            <Empty text="(add anchor keyframes below)" />
          ) : (
            draft.keyframes.map((kf, idx) => {
              const disp = kf.displacement ?? [0, 0, 0]
              const updateDisp = (axis: 0 | 1 | 2, cmValue: number) => {
                const next: [number, number, number] = [...disp]
                next[axis] = cmValue / 100   // cm → metres
                onUpdateKeyframe(idx, { displacement: next })
              }
              return (
                <div key={idx} style={keyframeBlockStyle}>
                  <div style={keyframeRowStyle}>
                    <select
                      value={kf.anchorId}
                      onChange={(e) => onUpdateKeyframe(idx, { anchorId: e.target.value })}
                      style={selectStyle}
                    >
                      {displayedAnchors.map((a) => (
                        <option
                          key={a.id}
                          value={a.id}
                          style={{ background: '#1c1f24', color: '#fff' }}
                        >
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      step={0.05}
                      min={0}
                      value={kf.time}
                      onChange={(e) =>
                        onUpdateKeyframe(idx, { time: parseFloat(e.target.value) || 0 })
                      }
                      style={timeInputStyle}
                    />
                    <span style={{ fontSize: 10, opacity: 0.5 }}>s</span>
                    <span style={delStyle} onClick={() => onRemoveKeyframe(idx)}>
                      ×
                    </span>
                  </div>
                  <div style={dispRowStyle}>
                    <span style={dispLabelStyle}>pos</span>
                    <DispInput label="X" value={Math.round(disp[0] * 100)} onChange={(v) => updateDisp(0, v)} />
                    <DispInput label="Y" value={Math.round(disp[1] * 100)} onChange={(v) => updateDisp(1, v)} />
                  </div>
                  <div style={dispRowStyle}>
                    <span style={dispLabelStyle}>{' '}</span>
                    <DispInput label="Z" value={Math.round(disp[2] * 100)} onChange={(v) => updateDisp(2, v)} />
                    <span style={{ fontSize: 9, opacity: 0.4 }}>cm</span>
                  </div>
                </div>
              )
            })
          )}
          <button style={btnGhost} onClick={onAddKeyframe}>
            + Add keyframe
          </button>
          <div style={btnRowStyle}>
            <button style={btnPrimary} onClick={onPreviewDraft}>▶ Preview</button>
            <button style={btnSecondary} onClick={onSaveDraft}>Save</button>
          </div>
          <button
            style={{ ...btnGhost, marginTop: 4 }}
            onClick={() => setDraft(null)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button style={btnNewAnim} onClick={onNewAnimation}>
          + New Animation
        </button>
      )}

      {/* Animations */}
      {/* Model edit modal */}
      {editingModel && (
        <div style={modalBackdropStyle} onClick={() => setEditingModel(null)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>Edit Model</div>

            <label style={modalFieldStyle}>
              <div style={modalLabelStyle}>Name</div>
              <input
                type="text"
                value={editingModel.name}
                onChange={(e) => setEditingModel({ ...editingModel, name: e.target.value })}
                style={modalSelectStyle}
              />
            </label>

            <div style={modalFieldStyle}>
              <div style={modalLabelStyle}>Visibility</div>
              <button
                type="button"
                style={{ ...modalBtnGhostStyle, width: '100%' }}
                onClick={() =>
                  setEditingModel({ ...editingModel, visible: !editingModel.visible })
                }
              >
                {editingModel.visible ? '👁  Visible — click to hide' : '🚫 Hidden — click to show'}
              </button>
            </div>

            <div style={modalBtnRowStyle}>
              <button style={modalBtnGhostStyle} onClick={() => setEditingModel(null)}>Cancel</button>
              <button
                style={modalBtnPrimaryStyle}
                onClick={() => {
                  const { idx, name, visible } = editingModel
                  setModels((curr) => curr.map((n, i) => (i === idx ? name.trim() || n : n)))
                  setModelVisibilities((curr) => ({ ...curr, [idx]: visible }))
                  ;(window as any).__editor?.setModelVisible?.(idx, visible)
                  setEditingModel(null)
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div style={modalBackdropStyle} onClick={() => setImportOpen(false)}>
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={modalTitleStyle}>Import Baked Animation</div>

            <label style={modalFieldStyle}>
              <div style={modalLabelStyle}>Animation</div>
              <select
                value={importPick}
                onChange={(e) => setImportPick(e.target.value)}
                style={modalSelectStyle}
              >
                {bakedList.map((b) => (
                  <option key={b.name} value={b.name} style={{ background: '#1c1f24', color: '#fff' }}>
                    {b.name.replace(/^Armature\|/, '')} ({Math.round(b.to - b.from)} frames)
                  </option>
                ))}
              </select>
            </label>

            <div style={modalFieldStyle}>
              <div style={modalLabelStyle}>Keyframes</div>
              <label style={radioRowStyle}>
                <input
                  type="radio"
                  checked={importMode === 'original'}
                  onChange={() => setImportMode('original')}
                />
                <span>Original (use the artist's keyframes — recommended)</span>
              </label>
              <label style={radioRowStyle}>
                <input
                  type="radio"
                  checked={importMode === 'custom'}
                  onChange={() => setImportMode('custom')}
                />
                <span>Custom count:</span>
                <input
                  type="number"
                  min={2}
                  max={30}
                  value={importCount}
                  onChange={(e) => setImportCount(parseInt(e.target.value) || 8)}
                  disabled={importMode !== 'custom'}
                  style={{
                    ...modalNumberStyle,
                    opacity: importMode === 'custom' ? 1 : 0.4,
                  }}
                />
              </label>
            </div>

            <div style={modalBtnRowStyle}>
              <button style={modalBtnGhostStyle} onClick={() => setImportOpen(false)}>Cancel</button>
              <button style={modalBtnPrimaryStyle} onClick={onConfirmImport}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Sync play — sequenced multi-step animation across opted-in models */}
      <Section label="Sync Play">
        {models.length === 0 || animations.length === 0 ? (
          <Empty text={animations.length === 0 ? '(save anims first)' : '(no models)'} />
        ) : (
          <>
            {/* Models in session — stacked column: label, chips, dropdown.
                The "+ add" stays in its own row whether chips are present
                or not so it's always findable. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: 10, opacity: 0.55, letterSpacing: 0.5 }}>MODELS</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {syncModels.length === 0 ? (
                  <span style={{ fontSize: 10, opacity: 0.45 }}>(none yet)</span>
                ) : (
                  syncModels.map((idx) => (
                    <span key={idx} style={syncModelChipStyle}>
                      {models[idx] ?? `#${idx}`}
                      <span
                        style={{ marginLeft: 4, cursor: 'pointer', opacity: 0.7 }}
                        onClick={() => removeSyncModel(idx)}
                        title="Remove from session"
                      >×</span>
                    </span>
                  ))
                )}
              </div>
              {models.some((_, i) => !syncModels.includes(i)) ? (
                <select
                  value=""
                  onChange={(e) => {
                    const n = parseInt(e.target.value, 10)
                    if (Number.isFinite(n)) addSyncModel(n)
                  }}
                  style={{ ...selectStyle, fontSize: 10, padding: '3px 6px', width: '100%' }}
                >
                  <option value="" style={{ background: '#1c1f24', color: '#fff' }}>+ add model</option>
                  {models.map((mName, i) =>
                    syncModels.includes(i) ? null : (
                      <option key={i} value={i} style={{ background: '#1c1f24', color: '#fff' }}>
                        {mName}
                      </option>
                    ),
                  )}
                </select>
              ) : null}
            </div>
            {/* Steps list */}
            {syncSteps.map((step, sIdx) => (
              <div key={step.id} style={syncStepStyle}>
                <div style={syncStepHeaderStyle}>
                  <span>Step {sIdx + 1}</span>
                  <span
                    style={{ cursor: 'pointer', opacity: 0.55, fontWeight: 700 }}
                    onClick={() => removeSyncStep(step.id)}
                    title="Delete step"
                  >×</span>
                </div>
                {syncModels.length === 0 ? (
                  <div style={{ fontSize: 10, opacity: 0.45, padding: '2px 0' }}>
                    (add a model to the session first)
                  </div>
                ) : (
                  syncModels.map((idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 10, opacity: 0.7, width: 60 }}>{models[idx] ?? `#${idx}`}</span>
                      <select
                        value={step.anims[idx] ?? ''}
                        onChange={(e) => setStepAnim(step.id, idx, e.target.value)}
                        style={{ ...selectStyle, flex: 1, fontSize: 10 }}
                      >
                        <option value="" style={{ background: '#1c1f24', color: '#fff' }}>(none)</option>
                        {animations.map((a) => (
                          <option key={a.id} value={a.id} style={{ background: '#1c1f24', color: '#fff' }}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))
                )}
              </div>
            ))}
            <button
              style={{ ...btnSecondary, width: '100%', marginTop: 4 }}
              onClick={addSyncStep}
            >
              + Add step
            </button>
            <button
              style={{ ...btnPrimary, width: '100%', marginTop: 6 }}
              onClick={onPlaySync}
              disabled={syncSteps.length === 0 || syncModels.length === 0}
            >
              ▶ Play all steps
            </button>
            {syncSteps.length > 0 || syncModels.length > 0 ? (
              <button
                style={{ ...btnGhost, marginTop: 4 }}
                onClick={() => {
                  setSyncModels([])
                  setSyncSteps([])
                }}
                title="Drop all models + steps from the sync session"
              >
                Clear
              </button>
            ) : null}
          </>
        )}
      </Section>

      <Section label={`Animations (${animations.length})`}>
        {animations.length === 0 ? (
          <Empty text="(none)" />
        ) : (
          animations.map((a) => (
            <AnimRow
              key={a.id}
              anim={a}
              onPlay={() => onPlayAnimation(a)}
              onDelete={() => onDeleteAnimation(a.id)}
              onEdit={() => onEditAnimation(a)}
              onMirror={() => onMirrorAnimation(a.id)}
              onSetKey={(side, key) =>
                setAnimations((curr) =>
                  curr.map((x) =>
                    x.id === a.id ? { ...x, [side === 'hero' ? 'heroKey' : 'oppKey']: key } : x,
                  ),
                )
              }
            />
          ))
        )}
      </Section>
    </div>
  )
}

function Section({
  label,
  children,
  action,
}: {
  label: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div style={sectionStyle}>
      <div style={sectionHeaderStyle}>
        <div style={labelStyle}>{label}</div>
        {action}
      </div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={emptyStyle}>{text}</div>
}

function ModelRow({
  name, active, hidden, focused, onClick, onToggleHidden, onFocus, onEdit,
}: {
  name: string
  active: boolean
  hidden: boolean
  focused: boolean
  onClick: () => void
  onToggleHidden: () => void
  onFocus: () => void
  onEdit: () => void
}) {
  return (
    <div
      style={{
        ...poseRowStyle,
        ...(active ? { background: 'rgba(95, 130, 200, 0.45)', color: '#fff' } : {}),
        opacity: hidden ? 0.4 : 1,
      }}
    >
      <span style={{ cursor: 'pointer', flex: 1, fontSize: 12 }} onClick={onClick}>
        {name}
        {hidden ? <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>(hidden)</span> : null}
      </span>
      {active ? <span style={{ fontSize: 10, opacity: 0.7, marginRight: 4 }}>✓</span> : null}
      <span
        style={focused ? focusBtnActiveStyle : penStyle}
        onClick={onFocus}
        title={focused ? 'Camera is focused on this model' : 'Focus camera on this model'}
      >
        🎯
      </span>
      <span
        style={penStyle}
        onClick={onToggleHidden}
        title={hidden ? 'Show model' : 'Hide model'}
      >
        {hidden ? '🚫' : '👁'}
      </span>
      <span style={penStyle} onClick={onEdit} title="Edit (rename, hide)">✎</span>
    </div>
  )
}

function DispInput({
  label, value, onChange,
}: {
  label: string
  value: number
  onChange: (cmValue: number) => void
}) {
  // type=text + inputMode so arrow keys MOVE THE CURSOR inside the field
  // (default type=number maps arrows to increment/decrement, which prevents
  // backspace-with-arrows-style editing).
  return (
    <label style={dispFieldStyle}>
      <span style={dispAxisLabelStyle}>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9-]/g, '')
          const parsed = parseInt(cleaned, 10)
          onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        onFocus={(e) => e.target.select()}
        style={dispInputBoxStyle}
      />
    </label>
  )
}

function AnimRow({
  anim, onPlay, onDelete, onEdit, onMirror, onSetKey,
}: {
  anim: AnimDef
  onPlay: () => void
  onDelete: () => void
  onEdit: () => void
  onMirror: () => void
  onSetKey: (side: 'hero' | 'opp', key: string) => void
}) {
  return (
    <div style={{ ...poseRowStyle, flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ cursor: 'pointer', flex: 1, fontSize: 12 }} onClick={onPlay}>
          <span style={{ marginRight: 6, opacity: 0.7 }}>▶</span>
          {anim.name}
          <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 10 }}>({anim.keyframes.length} kfs)</span>
        </span>
        <span style={penStyle} onClick={onEdit} title="Edit (name, keyframes, timing)">✎</span>
        <span style={penStyle} onClick={onMirror} title="Mirror left↔right (clone as opposite-side swing)">↔</span>
        <span style={delStyle} onClick={onDelete} title="Delete">×</span>
      </div>
      <div style={{ display: 'flex', gap: 6, fontSize: 10, opacity: 0.75 }}>
        <label style={keyBindLabelStyle}>
          Hero:
          <input
            type="text"
            value={anim.heroKey ?? ''}
            maxLength={1}
            onChange={(e) => onSetKey('hero', e.target.value.toLowerCase())}
            style={keyBindInputStyle}
            placeholder="-"
          />
        </label>
        <label style={keyBindLabelStyle}>
          Opp:
          <input
            type="text"
            value={anim.oppKey ?? ''}
            maxLength={1}
            onChange={(e) => onSetKey('opp', e.target.value.toLowerCase())}
            style={keyBindInputStyle}
            placeholder="-"
          />
        </label>
      </div>
    </div>
  )
}

function ListRow({
  name,
  suffix,
  onClick,
  onDelete,
  onRename,
  onMirror,
  icon,
}: {
  name: string
  suffix?: string
  onClick: () => void
  onDelete?: () => void
  onRename?: () => void
  onMirror?: () => void
  icon?: string
}) {
  return (
    <div style={poseRowStyle}>
      <span style={{ cursor: 'pointer', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={onClick}>
        {icon ? <span style={{ marginRight: 6, opacity: 0.7 }}>{icon}</span> : null}
        {name}
        {suffix ? <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 10 }}>{suffix}</span> : null}
      </span>
      {onRename ? (
        <span style={penStyle} onClick={onRename} title="Rename">
          ✎
        </span>
      ) : null}
      {onMirror ? (
        <span style={penStyle} onClick={onMirror} title="Mirror left↔right (clone)">
          ↔
        </span>
      ) : null}
      {onDelete ? (
        <span style={delStyle} onClick={onDelete} title="Delete">
          ×
        </span>
      ) : (
        <span style={{ ...delStyle, opacity: 0.15, cursor: 'default' }} title="System anchor">
          •
        </span>
      )}
    </div>
  )
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  bottom: 0,
  width: 260,
  background: 'rgba(20, 22, 25, 0.92)',
  color: '#fff',
  padding: 14,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  overflowY: 'auto',
  zIndex: 10,
  borderRight: '1px solid rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(6px)',
}

const titleStyle: CSSProperties = {
  margin: '0 0 14px 0',
  fontSize: 12,
  letterSpacing: 1.5,
  fontWeight: 600,
  opacity: 0.85,
}

const sectionStyle: CSSProperties = { marginBottom: 14 }
const sectionHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  marginBottom: 4,
}
const sectionPlusBtnStyle: CSSProperties = {
  background: 'rgba(95, 130, 200, 0.55)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 4,
  width: 22,
  height: 18,
  fontSize: 14,
  lineHeight: 1,
  fontWeight: 700,
  padding: 0,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const labelStyle: CSSProperties = {
  opacity: 0.55,
  fontSize: 10,
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 4,
}

const boneStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  padding: '6px 8px',
  background: 'rgba(255, 255, 255, 0.06)',
  borderRadius: 4,
  minHeight: 20,
}

const btnRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 12,
}

const btnPrimary: CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  background: 'rgba(95, 130, 200, 0.55)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 500,
}

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: 'rgba(255, 255, 255, 0.07)',
}
// Sync-play model chip — opted-in model identifier with × to remove.
const syncModelChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  fontSize: 10,
  padding: '2px 6px',
  background: 'rgba(95, 130, 200, 0.35)',
  border: '1px solid rgba(95, 130, 200, 0.55)',
  borderRadius: 10,
  color: '#fff',
}
// Sync-play step wrapper — visually grouped per-step row of model→anim
// selections.
const syncStepStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 4,
  padding: '6px 8px',
  marginBottom: 6,
}
const syncStepHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: 11,
  fontWeight: 600,
  opacity: 0.85,
  marginBottom: 4,
}

const btnGhost: CSSProperties = {
  ...btnPrimary,
  flex: 'unset',
  width: '100%',
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  padding: '6px 10px',
  fontSize: 11,
}

const btnNewAnim: CSSProperties = {
  ...btnGhost,
  marginBottom: 14,
  borderStyle: 'dashed',
  fontWeight: 500,
}

const emptyStyle: CSSProperties = { opacity: 0.4, fontSize: 11, padding: '4px 0' }

const poseRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '6px 8px',
  margin: '3px 0',
  background: 'rgba(255, 255, 255, 0.06)',
  borderRadius: 3,
  fontSize: 12,
}

const delStyle: CSSProperties = {
  opacity: 0.5,
  cursor: 'pointer',
  marginLeft: 6,
  fontWeight: 700,
  padding: '0 4px',
}

const penStyle: CSSProperties = {
  opacity: 0.45,
  cursor: 'pointer',
  marginLeft: 4,
  fontSize: 11,
  padding: '0 4px',
}
// 🎯 icon when the camera is locked on this model — full opacity + an
// orange pill background so it's obvious at a glance which row owns the
// camera. Other rows show the dim default style.
const focusBtnActiveStyle: CSSProperties = {
  opacity: 1,
  cursor: 'pointer',
  marginLeft: 4,
  fontSize: 11,
  padding: '1px 5px',
  background: 'rgba(240, 160, 60, 0.6)',
  border: '1px solid rgba(255, 200, 110, 0.85)',
  borderRadius: 4,
  boxShadow: '0 0 4px rgba(240, 160, 60, 0.55)',
}

const keyBindLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
}

const keyBindInputStyle: CSSProperties = {
  width: 22,
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 3,
  padding: '2px 4px',
  fontFamily: 'inherit',
  fontSize: 11,
  outline: 'none',
  textAlign: 'center',
  textTransform: 'lowercase',
}

const modalBackdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backdropFilter: 'blur(2px)',
}

const modalStyle: CSSProperties = {
  background: '#23272d',
  color: '#fff',
  borderRadius: 8,
  padding: 22,
  width: 360,
  maxWidth: '90vw',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  border: '1px solid rgba(255,255,255,0.1)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}

const modalTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 1,
  textTransform: 'uppercase',
  opacity: 0.85,
  marginBottom: 18,
}

const modalFieldStyle: CSSProperties = {
  display: 'block',
  marginBottom: 16,
}

const modalLabelStyle: CSSProperties = {
  opacity: 0.6,
  fontSize: 10,
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 6,
}

const modalSelectStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 5,
  fontFamily: 'inherit',
  fontSize: 13,
  outline: 'none',
  cursor: 'pointer',
}

const radioRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  padding: '4px 0',
  cursor: 'pointer',
}

const modalNumberStyle: CSSProperties = {
  width: 48,
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 4,
  padding: '4px 6px',
  fontFamily: 'inherit',
  fontSize: 12,
  outline: 'none',
  textAlign: 'center',
}

const modalBtnRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 8,
}

const modalBtnPrimaryStyle: CSSProperties = {
  padding: '8px 18px',
  background: 'rgba(95, 130, 200, 0.7)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
  fontWeight: 500,
}

const modalBtnGhostStyle: CSSProperties = {
  padding: '8px 14px',
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: 5,
  cursor: 'pointer',
  fontSize: 13,
  fontFamily: 'inherit',
}

const builderStyle: CSSProperties = {
  background: 'rgba(0, 0, 0, 0.25)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 6,
  padding: 10,
  marginBottom: 14,
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 12,
  outline: 'none',
  marginBottom: 4,
}

const keyframeBlockStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '4px 6px',
  marginBottom: 4,
  background: 'rgba(255, 255, 255, 0.03)',
  borderRadius: 4,
}

const keyframeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
}

const dispRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginLeft: 6,
  paddingTop: 2,
}

const dispLabelStyle: CSSProperties = {
  fontSize: 9,
  opacity: 0.45,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  width: 22,
}

const dispFieldStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
}

const dispAxisLabelStyle: CSSProperties = {
  fontSize: 9,
  opacity: 0.55,
  fontWeight: 600,
  width: 8,
  textAlign: 'center',
}

const dispInputBoxStyle: CSSProperties = {
  width: 56,
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '3px 5px',
  fontFamily: 'monospace',
  fontSize: 11,
  outline: 'none',
  textAlign: 'right',
}

const selectStyle: CSSProperties = {
  flex: 1,
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '3px 4px',
  fontFamily: 'inherit',
  fontSize: 11,
  outline: 'none',
}

const timeInputStyle: CSSProperties = {
  width: 50,
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '3px 4px',
  fontFamily: 'inherit',
  fontSize: 11,
  outline: 'none',
}

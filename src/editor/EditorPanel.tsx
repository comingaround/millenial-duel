import { CSSProperties, useEffect, useState } from 'react'

type RotationMap = Record<string, [number, number, number, number]>
type PositionMap = Record<string, [number, number, number]>

type Pose = { id: string; name: string; rotations: RotationMap; positions?: PositionMap }
type Anchor = {
  id: string; name: string; rotations: RotationMap; positions?: PositionMap; system?: boolean
}

type AnimKeyframe = { anchorId: string; time: number }
type AnimDef = {
  id: string
  name: string
  keyframes: AnimKeyframe[]
  heroKey?: string
  oppKey?: string
}

type DraftAnim = { name: string; keyframes: AnimKeyframe[]; editingId?: string }

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
  const [animations, setAnimations] = useState<AnimDef[]>([])
  const [draft, setDraft] = useState<DraftAnim | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [editorReady, setEditorReady] = useState(false)
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

    const hydrate = async () => {
      try {
        const res = await fetch('/api/animations')
        if (res.ok) {
          const data = await res.json()
          if (cancelled) return
          if (Array.isArray(data.poses))      setPoses(data.poses)
          // Filter out any persisted system anchors (e.g. Initial) — we add
          // them back at render time.
          if (Array.isArray(data.anchors))
            setAnchors(data.anchors.filter((a: Anchor) => !a.system))
          if (Array.isArray(data.animations)) setAnimations(data.animations)
        }
      } catch {
        // No persistence endpoint (e.g. production build) — silent
      }
      setHydrated(true)
    }
    hydrate()

    const tryAttach = () => {
      const ed = window.__editor
      if (!ed) return false
      unsub = ed.addBoneSelectListener((name) => setSelectedBone(name))
      setSelectedBone(ed.getSelectedBone())
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
      }
    }
    return () => {
      cancelled = true
      unsub?.()
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

  // Persist library to disk on every change (debounced 500ms). Skip during
  // initial hydration so we don't immediately overwrite the loaded data
  // with the empty default state.
  useEffect(() => {
    if (!hydrated) return
    const timer = setTimeout(() => {
      const payload = {
        poses,
        anchors: anchors.filter((a) => !a.system), // skip Initial position
        animations,
      }
      fetch('/api/animations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload, null, 2),
      }).catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [poses, anchors, animations, hydrated])

  // Expose resolved animations to window so engine.ts can dispatch keys
  useEffect(() => {
    const resolved = animations.map((a) => ({
      ...a,
      resolved: a.keyframes
        .map((kf) => {
          const an = displayedAnchors.find((x) => x.id === kf.anchorId)
          return an
            ? { anchor: { rotations: an.rotations, positions: an.positions }, time: kf.time }
            : null
        })
        .filter((x) => x !== null) as Array<{
          anchor: { rotations: RotationMap; positions?: PositionMap }
          time: number
        }>,
    }))
    ;(window as any).__customAnims = resolved
  }, [animations, anchors, editorReady])

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
          ? { anchor: { rotations: anchor.rotations, positions: anchor.positions }, time: kf.time }
          : null
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)

  const onPreviewDraft = () => {
    if (!draft) return
    const resolved = resolveKeyframes(draft.keyframes)
    if (resolved.length < 2) {
      alert('Need at least 2 keyframes to preview.')
      return
    }
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
            ? { ...x, name: draft.name, keyframes: draft.keyframes }
            : x,
        ),
      )
    } else {
      const newAnim: AnimDef = {
        id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `anim_${Date.now()}`,
        name: draft.name,
        keyframes: draft.keyframes,
      }
      setAnimations((a) => [...a, newAnim])
    }
    setDraft(null)
  }

  const onPlayAnimation = (anim: AnimDef) => {
    const resolved = resolveKeyframes(anim.keyframes)
    if (resolved.length < 2) return
    window.__editor?.playAnimation(resolved)
  }

  return (
    <div style={panelStyle}>
      <h3 style={titleStyle}>EDITOR</h3>

      {/* Save buttons */}
      <div style={btnRowStyle}>
        <button style={btnPrimary} onClick={onSavePose}>Save Pose</button>
        <button style={btnSecondary} onClick={onSaveAnchor}>Save Anchor</button>
      </div>
      <button style={{ ...btnPrimary, width: '100%', marginBottom: 14, background: 'rgba(150, 110, 60, 0.55)' }} onClick={onOpenImport}>
        ⬇ Import baked animation
      </button>

      {/* Poses */}
      <Section label={`Poses (${poses.length})`}>
        {poses.length === 0 ? (
          <Empty text="(none)" />
        ) : (
          poses.map((p) => (
            <ListRow
              key={p.id}
              name={p.name}
              onClick={() => onApplyPose(p)}
              onDelete={() => onDeletePose(p.id)}
              onRename={promptRename(p.name, (n) => onRenamePose(p.id, n))}
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
          <div style={{ ...labelStyle, marginTop: 8 }}>Keyframes</div>
          {draft.keyframes.length === 0 ? (
            <Empty text="(add anchor keyframes below)" />
          ) : (
            draft.keyframes.map((kf, idx) => (
              <div key={idx} style={keyframeRowStyle}>
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
            ))
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={sectionStyle}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div style={emptyStyle}>{text}</div>
}

function AnimRow({
  anim, onPlay, onDelete, onEdit, onSetKey,
}: {
  anim: AnimDef
  onPlay: () => void
  onDelete: () => void
  onEdit: () => void
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
  icon,
}: {
  name: string
  suffix?: string
  onClick: () => void
  onDelete?: () => void
  onRename?: () => void
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

const keyframeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 0',
  fontSize: 11,
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

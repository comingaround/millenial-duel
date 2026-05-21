import { CSSProperties, useEffect, useState } from 'react'

type Pose = {
  id: string
  name: string
  rotations: Record<string, [number, number, number, number]>
}

type EditorApi = {
  snapshot: (name: string) => Pose
  apply: (pose: { rotations: Record<string, [number, number, number, number]> }) => void
  reset: () => void
  selectBone: (name: string | null) => void
  rotateSelectedBone: (axis: 'x' | 'y' | 'z', deltaRad: number) => void
  getSelectedBone: () => string | null
  getActiveBones: () => string[]
  getAllBoneNames: () => string[]
  addBoneSelectListener: (cb: (name: string | null) => void) => () => void
}

declare global {
  interface Window {
    __editor?: EditorApi
  }
}

export default function EditorPanel() {
  const [selectedBone, setSelectedBone] = useState<string | null>(null)
  const [poses, setPoses] = useState<Pose[]>([])

  useEffect(() => {
    let unsub: (() => void) | null = null
    const tryAttach = () => {
      const ed = window.__editor
      if (!ed) return false
      unsub = ed.addBoneSelectListener((name) => setSelectedBone(name))
      setSelectedBone(ed.getSelectedBone())
      return true
    }
    if (!tryAttach()) {
      const interval = setInterval(() => {
        if (tryAttach()) clearInterval(interval)
      }, 200)
      return () => {
        clearInterval(interval)
        unsub?.()
      }
    }
    return () => unsub?.()
  }, [])

  const onSavePose = () => {
    const ed = window.__editor
    if (!ed) return
    const defaultName = `Pose ${poses.length + 1}`
    const name = window.prompt('Pose name:', defaultName)
    if (!name) return
    const pose = ed.snapshot(name)
    setPoses((prev) => [...prev, pose])
  }

  const onApplyPose = (pose: Pose) => window.__editor?.apply(pose)
  const onDeletePose = (id: string) =>
    setPoses((prev) => prev.filter((p) => p.id !== id))
  const onReset = () => window.__editor?.reset()

  return (
    <div style={panelStyle}>
      <h3 style={titleStyle}>EDITOR</h3>

      <div style={sectionStyle}>
        <div style={labelStyle}>Selected</div>
        <div style={boneStyle}>
          {selectedBone ?? (
            <span style={{ opacity: 0.4 }}>(none — pick from right panel)</span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        <button style={btnPrimary} onClick={onSavePose}>Save Pose</button>
        <button
          style={{ ...btnSecondary, opacity: 0.35, cursor: 'not-allowed' }}
          disabled
          title="Available in Phase 2"
        >
          Save Animation
        </button>
        <button style={btnGhost} onClick={onReset}>Reset to rest</button>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Poses ({poses.length})</div>
        {poses.length === 0 ? (
          <div style={emptyStyle}>(none yet)</div>
        ) : (
          poses.map((p) => (
            <div key={p.id} style={poseRowStyle}>
              <span
                style={{ cursor: 'pointer', flex: 1 }}
                onClick={() => onApplyPose(p)}
                title="Apply this pose"
              >
                {p.name}
              </span>
              <span
                style={delStyle}
                onClick={() => onDeletePose(p.id)}
                title="Delete"
              >
                ×
              </span>
            </div>
          ))
        )}
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Animations</div>
        <div style={emptyStyle}>Phase 2</div>
      </div>
    </div>
  )
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  bottom: 0,
  width: 240,
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

const btnPrimary: CSSProperties = {
  padding: '8px 12px',
  background: 'rgba(95, 130, 200, 0.55)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 500,
}
const btnSecondary: CSSProperties = { ...btnPrimary, background: 'rgba(255,255,255,0.07)' }
const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: 'transparent',
  border: '1px solid rgba(255, 255, 255, 0.18)',
}

const emptyStyle: CSSProperties = { opacity: 0.4, fontSize: 12, padding: '4px 0' }

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
  marginLeft: 8,
  fontWeight: 700,
  padding: '0 4px',
}

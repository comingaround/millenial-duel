import { CSSProperties } from 'react'

export type CameraMode = 'free' | 'locked' | 'editor'

const LABELS: Record<CameraMode, string> = {
  free: 'Free Roam',
  locked: 'Locked (FPS)',
  editor: 'Editor',
}

export default function CameraToggle({
  mode,
  onModeChange,
}: {
  mode: CameraMode
  onModeChange: (mode: CameraMode) => void
}) {
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value as CameraMode
    onModeChange(next)
    ;(window as any).__bjs?.setCameraMode?.(next)
  }

  return (
    <div style={wrapStyle}>
      <span style={labelStyle}>Camera:</span>
      <select value={mode} onChange={onChange} style={selectStyle}>
        {(Object.keys(LABELS) as CameraMode[]).map((k) => (
          <option key={k} value={k} style={optionStyle}>
            {LABELS[k]}
          </option>
        ))}
      </select>
    </div>
  )
}

const wrapStyle: CSSProperties = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  background: 'rgba(0, 0, 0, 0.62)',
  border: '1px solid rgba(255, 255, 255, 0.35)',
  borderRadius: 6,
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  color: '#fff',
  backdropFilter: 'blur(4px)',
  zIndex: 11,
}

const labelStyle: CSSProperties = {
  opacity: 0.85,
  letterSpacing: 0.3,
}

const selectStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: 4,
  padding: '4px 8px',
  fontFamily: 'inherit',
  fontSize: 13,
  cursor: 'pointer',
  outline: 'none',
}

const optionStyle: CSSProperties = {
  background: '#1c1f24',
  color: '#fff',
}

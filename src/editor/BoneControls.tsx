import { CSSProperties, useEffect, useRef, useState } from 'react'

type Axis = 'x' | 'y' | 'z'
const SENSITIVITY = 0.008   // rad per pixel of horizontal drag

export default function BoneControls() {
  const [selected, setSelected] = useState<string | null>(null)
  const [activeBones, setActiveBones] = useState<string[]>([])
  const [allBones, setAllBones] = useState<string[]>([])

  useEffect(() => {
    let unsub: (() => void) | null = null
    const tryAttach = () => {
      const ed = (window as any).__editor
      if (!ed) return false
      setSelected(ed.getSelectedBone())
      setActiveBones(ed.getActiveBones())
      setAllBones(ed.getAllBoneNames())
      unsub = ed.addBoneSelectListener((name: string | null) => setSelected(name))
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

  const activeSet = new Set(activeBones)
  const enabled = selected !== null

  const onClickBone = (name: string) => {
    if (!activeSet.has(name)) return
    ;(window as any).__editor?.selectBone(name)
  }

  return (
    <div style={panelStyle}>
      <div style={titleStyle}>BONES</div>
      <div style={subtitleStyle}>
        {activeBones.length} active / {allBones.length} total
      </div>
      <div style={boneListStyle}>
        {categorize(allBones).map((cat) => (
          <div key={cat.name}>
            <div style={categoryHeaderStyle}>{cat.name}</div>
            {cat.bones.map((b) => {
              const isActive = activeSet.has(b)
              const isSelected = selected === b
              return (
                <div
                  key={b}
                  onClick={() => onClickBone(b)}
                  style={{
                    ...boneRowStyle,
                    ...(isActive ? boneRowActive : boneRowInactive),
                    ...(isSelected ? boneRowSelected : {}),
                  }}
                  title={isActive ? 'Click to select' : 'Not editable yet (Phase 1)'}
                >
                  {b}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div style={dividerStyle} />

      <div style={titleStyle}>ROTATE</div>
      <div style={subtitleStyle}>
        {selected ?? '(no bone selected)'}
      </div>
      <div style={knobRowStyle}>
        <Knob axis="x" label="X" color="#e64545" disabled={!enabled} />
        <Knob axis="y" label="Y" color="#4cbd49" disabled={!enabled} />
        <Knob axis="z" label="Z" color="#3a82e6" disabled={!enabled} />
      </div>
      <div style={hintStyle}>drag ↔ horizontally</div>
    </div>
  )
}

function Knob({
  axis,
  label,
  color,
  disabled,
}: {
  axis: Axis
  label: string
  color: string
  disabled: boolean
}) {
  const lastX = useRef(0)
  const dragging = useRef(false)
  const [active, setActive] = useState(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    lastX.current = e.clientX
    setActive(true)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastX.current
    lastX.current = e.clientX
    ;(window as any).__editor?.rotateSelectedBone?.(axis, dx * SENSITIVITY)
  }

  const stop = (e: React.PointerEvent) => {
    if (!dragging.current) return
    dragging.current = false
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
    setActive(false)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      style={{
        ...knobStyle,
        background: `radial-gradient(circle at 32% 30%, ${lighten(color)}, ${color} 55%, ${darken(color)} 95%)`,
        cursor: disabled ? 'not-allowed' : 'ew-resize',
        opacity: disabled ? 0.3 : 1,
        outline: active ? '2px solid rgba(255,255,255,0.7)' : 'none',
        outlineOffset: 2,
      }}
    >
      <span style={knobLabelStyle}>{label}</span>
    </div>
  )
}

// Categorize bones by anatomy, preserving GLB input order within each group.
function categorize(allBones: string[]): Array<{ name: string; bones: string[] }> {
  const groups: Record<string, string[]> = {
    'Torso': [],
    'Left Arm': [],
    'Right Arm': [],
    'Left Leg': [],
    'Right Leg': [],
    'IK Helpers': [],
    'Other': [],
  }
  for (const b of allBones) {
    if (/IK|Pole Target/.test(b)) {
      groups['IK Helpers'].push(b)
    } else if (/^(Hips|Spine|Chest|Neck|Head)$/.test(b)) {
      groups['Torso'].push(b)
    } else if (/\.L$/.test(b) && /(Arm|Hand|Finger|Thumb|Shoulder)/.test(b)) {
      groups['Left Arm'].push(b)
    } else if (/\.R$/.test(b) && /(Arm|Hand|Finger|Thumb|Shoulder)/.test(b)) {
      groups['Right Arm'].push(b)
    } else if (/\.L$/.test(b) && /(Leg|Foot|Toes)/.test(b)) {
      groups['Left Leg'].push(b)
    } else if (/\.R$/.test(b) && /(Leg|Foot|Toes)/.test(b)) {
      groups['Right Leg'].push(b)
    } else {
      groups['Other'].push(b)
    }
  }
  return Object.entries(groups)
    .filter(([, list]) => list.length > 0)
    .map(([name, bones]) => ({ name, bones }))
}

function lighten(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, ((n >> 16) & 0xff) + 70)
  const g = Math.min(255, ((n >> 8) & 0xff) + 70)
  const b = Math.min(255, (n & 0xff) + 70)
  return `rgb(${r},${g},${b})`
}
function darken(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, ((n >> 16) & 0xff) - 70)
  const g = Math.max(0, ((n >> 8) & 0xff) - 70)
  const b = Math.max(0, (n & 0xff) - 70)
  return `rgb(${r},${g},${b})`
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  right: 0,
  top: 0,
  bottom: 0,
  width: 240,
  padding: 14,
  background: 'rgba(20, 22, 25, 0.92)',
  color: '#fff',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  zIndex: 9,
  borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(6px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
}

const titleStyle: CSSProperties = {
  fontSize: 12,
  letterSpacing: 1.5,
  fontWeight: 600,
  opacity: 0.85,
  marginBottom: 2,
}

const subtitleStyle: CSSProperties = {
  fontSize: 11,
  opacity: 0.55,
  marginBottom: 8,
}

const boneListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  background: 'rgba(0, 0, 0, 0.22)',
  borderRadius: 4,
  padding: 4,
  maxHeight: 320,
  overflowY: 'auto',
  marginBottom: 4,
}

const categoryHeaderStyle: CSSProperties = {
  padding: '6px 8px 3px 8px',
  marginTop: 4,
  fontSize: 9.5,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  color: 'rgba(255, 255, 255, 0.5)',
  fontWeight: 600,
  borderTop: '1px solid rgba(255, 255, 255, 0.06)',
}

const boneRowStyle: CSSProperties = {
  padding: '4px 8px',
  fontSize: 11.5,
  borderRadius: 3,
}

const boneRowActive: CSSProperties = {
  cursor: 'pointer',
  color: '#ffdd66',
  fontWeight: 500,
}

const boneRowInactive: CSSProperties = {
  color: 'rgba(255, 255, 255, 0.3)',
  cursor: 'default',
}

const boneRowSelected: CSSProperties = {
  background: 'rgba(220, 40, 40, 0.35)',
  color: '#ff8888',
  fontWeight: 600,
}

const dividerStyle: CSSProperties = {
  height: 1,
  background: 'rgba(255,255,255,0.08)',
  margin: '14px 0 12px 0',
}

const knobRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  marginTop: 10,
  marginBottom: 10,
}

const hintStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.45,
  textAlign: 'center',
}

const knobStyle: CSSProperties = {
  width: 90,
  height: 90,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: 'inset -4px -6px 9px rgba(0,0,0,0.4)',
  touchAction: 'none',
  flexShrink: 0,
  transition: 'outline-color 120ms',
}

const knobLabelStyle: CSSProperties = {
  fontSize: 30,
  fontWeight: 700,
  color: '#fff',
  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
  pointerEvents: 'none',
}

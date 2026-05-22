import { CSSProperties, useEffect, useRef, useState } from 'react'

type Axis = 'x' | 'y' | 'z'

// Rotation: drag-based sphere knob
const SENSITIVITY = 0.008   // rad per pixel of horizontal drag

// Translation: stepper UI
const POS_STEP_M = 0.01              // 1 cm per click / wheel notch
// Multi-step burst: consecutive translation interactions inside this window
// count as ONE undo entry — keeps the undo stack from filling on wheel scrolls.
const UNDO_BURST_MS = 300

type PanelMode = 'bones' | 'style'
type EditorMaterial = { name: string; hex: string }

export default function BoneControls() {
  const [panelMode, setPanelMode] = useState<PanelMode>('bones')
  const [selected, setSelected] = useState<string | null>(null)
  const [activeBones, setActiveBones] = useState<string[]>([])
  const [allBones, setAllBones] = useState<string[]>([])
  const [euler, setEuler] = useState<{ x: number; y: number; z: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; z: number } | null>(null)
  const [materials, setMaterials] = useState<EditorMaterial[]>([])

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

  // Poll the selected bone's Euler angles + position each frame for the readout.
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      const ed = (window as any).__editor
      setEuler(ed?.getSelectedBoneEuler?.() ?? null)
      setPos(ed?.getSelectedBonePosition?.() ?? null)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // When switching modes: hide bone spheres in Style mode (so armor is visually
  // clear), and refresh the material list. Restore bone spheres when leaving.
  useEffect(() => {
    const ed = (window as any).__editor
    if (!ed) return
    if (panelMode === 'style') {
      ed.setBonePickerActive?.(false)
      ed.selectBone?.(null)
      const mats: EditorMaterial[] = ed.getEditorMaterials?.() ?? []
      // Stable display order: alphabetical by name.
      mats.sort((a, b) => a.name.localeCompare(b.name))
      setMaterials(mats)
    } else {
      ed.setBonePickerActive?.(true)
    }
  }, [panelMode])

  const onMaterialColor = (matName: string, hex: string) => {
    ;(window as any).__editor?.setEditorMaterialColor?.(matName, hex)
    setMaterials((curr) => curr.map((m) => (m.name === matName ? { ...m, hex } : m)))
  }

  const onResetMaterials = () => {
    const ed = (window as any).__editor
    ed?.resetEditorMaterials?.()
    // Re-read so the swatches sync to the restored colors.
    const mats: EditorMaterial[] = ed?.getEditorMaterials?.() ?? []
    mats.sort((a, b) => a.name.localeCompare(b.name))
    setMaterials(mats)
  }

  const hasPositionControl =
    selected !== null &&
    (window as any).__editor?.hasPositionControl?.(selected) === true

  const activeSet = new Set(activeBones)
  const enabled = selected !== null

  const onClickBone = (name: string) => {
    if (!activeSet.has(name)) return
    ;(window as any).__editor?.selectBone(name)
  }

  return (
    <div style={panelStyle}>
      {/* Top tabs: Bones / Style */}
      <div style={tabsStyle}>
        <button
          style={{ ...tabStyle, ...(panelMode === 'bones' ? tabActiveStyle : {}) }}
          onClick={() => setPanelMode('bones')}
        >
          Bones
        </button>
        <button
          style={{ ...tabStyle, ...(panelMode === 'style' ? tabActiveStyle : {}) }}
          onClick={() => setPanelMode('style')}
        >
          Style
        </button>
      </div>

      {panelMode === 'style' ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={titleStyle}>MATERIALS</div>
          <div style={subtitleStyle}>{materials.length} slots — click swatch to recolor</div>
          <div style={materialListStyle}>
            {materials.map((m) => (
              <label key={m.name} style={materialRowStyle}>
                <input
                  type="color"
                  value={m.hex}
                  onChange={(e) => onMaterialColor(m.name, e.target.value)}
                  style={swatchStyle}
                />
                <span style={materialNameStyle}>{m.name}</span>
                <span style={materialHexStyle}>{m.hex.toUpperCase()}</span>
              </label>
            ))}
          </div>
          <button style={resetBtnStyle} onClick={onResetMaterials}>
            Reset to default colors
          </button>
        </div>
      ) : (
      <>
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
        <KnobWithReadout axis="x" label="X" color="#e64545" value={euler?.x} disabled={!enabled} />
        <KnobWithReadout axis="y" label="Y" color="#4cbd49" value={euler?.y} disabled={!enabled} />
        <KnobWithReadout axis="z" label="Z" color="#3a82e6" value={euler?.z} disabled={!enabled} />
      </div>
      <div style={hintStyle}>drag ↔ horizontally</div>

      {hasPositionControl && (
        <>
          <div style={{ ...titleStyle, marginTop: 16 }}>TRANSLATE</div>
          <div style={subtitleStyle}>offset from rest (cm, world)</div>
          <div style={stepperColStyle}>
            <Stepper
              axis="x" label="X" color="#c44b4b"
              value={pos ? pos.x * 100 : undefined} unit="cm" precision={1} step={POS_STEP_M}
              enabled
              onStep={(d) => (window as any).__editor?.translateSelectedBone?.('x', d)}
            />
            <Stepper
              axis="y" label="Y" color="#3d9c3a"
              value={pos ? pos.y * 100 : undefined} unit="cm" precision={1} step={POS_STEP_M}
              enabled
              onStep={(d) => (window as any).__editor?.translateSelectedBone?.('y', d)}
            />
            <Stepper
              axis="z" label="Z" color="#3270c7"
              value={pos ? pos.z * 100 : undefined} unit="cm" precision={1} step={POS_STEP_M}
              enabled
              onStep={(d) => (window as any).__editor?.translateSelectedBone?.('z', d)}
            />
          </div>
          <div style={hintStyle}>Y = crouch · X = side · Z = fwd/back</div>
        </>
      )}

      <div style={btnGroupStyle}>
        <button
          style={miniBtnStyle}
          onClick={() => (window as any).__editor?.undo()}
          title="Undo (Ctrl+Z)"
        >
          ↶ Undo
        </button>
        <button
          style={miniBtnStyle}
          onClick={() => (window as any).__editor?.redo()}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          ↷ Redo
        </button>
      </div>
      <button
        style={resetBtnStyle}
        onClick={() => (window as any).__editor?.reset()}
      >
        Reset to rest pose
      </button>
      </>
      )}
    </div>
  )
}

function KnobWithReadout({
  axis, label, color, value, disabled,
}: {
  axis: Axis; label: string; color: string; value: number | undefined; disabled: boolean
}) {
  return (
    <div style={knobWithReadoutStyle}>
      <Knob axis={axis} label={label} color={color} disabled={disabled} />
      <div style={readoutStyle}>
        {value !== undefined ? `${value.toFixed(0)}°` : '—'}
      </div>
    </div>
  )
}

function Knob({
  axis, label, color, disabled,
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
    ;(window as any).__editor?.pushUndo?.()
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

function Stepper({
  label, color, value, unit, precision, step, enabled, onStep,
}: {
  axis: Axis
  label: string
  color: string
  value: number | undefined
  unit: string
  precision: number
  step: number
  enabled: boolean
  onStep: (delta: number) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const lastStepTime = useRef(0)

  // Display→underlying conversion. The `value` prop is in display units (e.g. cm)
  // while `step` and `onStep` operate in underlying units (m). For cm display
  // that's a 100x factor; for unitless or m it's 1.
  const displayToUnderlying = unit === 'cm' ? 0.01 : unit === 'mm' ? 0.001 : 1

  // Editable text state for the typed input. Synced from `value` only when
  // not focused — otherwise the parent's frame-by-frame poll would clobber
  // whatever the user is typing.
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (focused) return
    setText(value !== undefined ? value.toFixed(precision) : '')
  }, [value, precision, focused])

  const beginActionMaybe = () => {
    // Push undo only when starting a new "burst" (no step in last UNDO_BURST_MS).
    // Lets a long wheel scroll or a rapid click streak collapse into one undo.
    const now = Date.now()
    if (now - lastStepTime.current > UNDO_BURST_MS) {
      ;(window as any).__editor?.pushUndo?.()
    }
    lastStepTime.current = now
  }

  const doStep = (sign: 1 | -1) => {
    if (!enabled) return
    beginActionMaybe()
    onStep(sign * step)
  }

  const commitTyped = () => {
    if (!enabled) {
      setText(value !== undefined ? value.toFixed(precision) : '')
      return
    }
    const n = parseFloat(text)
    if (!Number.isFinite(n) || value === undefined) {
      setText(value !== undefined ? value.toFixed(precision) : '')
      return
    }
    const deltaDisplay = n - value
    if (deltaDisplay === 0) return
    ;(window as any).__editor?.pushUndo?.()
    onStep(deltaDisplay * displayToUnderlying)
    // Reset burst guard so the next click/scroll counts as a fresh action.
    lastStepTime.current = 0
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!enabled) return
      // Don't fight the typed input — let native wheel-step the number while focused.
      if (focused) return
      e.preventDefault()
      doStep(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [enabled, focused])

  return (
    <div
      ref={containerRef}
      style={{
        ...stepperRowStyle,
        opacity: enabled ? 1 : 0.35,
        borderLeft: `3px solid ${color}`,
      }}
      title={enabled ? 'Click ± · scroll to step · type a number + Enter to jump' : 'Select a bone first'}
    >
      <span style={{ ...stepperAxisStyle, color }}>{label}</span>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => doStep(-1)}
        style={{ ...stepperBtnStyle, cursor: enabled ? 'pointer' : 'not-allowed' }}
      >−</button>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onBlur={() => {
          setFocused(false)
          commitTyped()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(value !== undefined ? value.toFixed(precision) : '')
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        disabled={!enabled}
        style={stepperInputStyle}
      />
      <span style={stepperUnitStyle}>{unit}</span>
      <button
        type="button"
        disabled={!enabled}
        onClick={() => doStep(1)}
        style={{ ...stepperBtnStyle, cursor: enabled ? 'pointer' : 'not-allowed' }}
      >+</button>
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
  userSelect: 'none',
  WebkitUserSelect: 'none',
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
  maxHeight: 240,
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

const tabsStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  marginBottom: 12,
  background: 'rgba(0, 0, 0, 0.25)',
  padding: 3,
  borderRadius: 6,
}

const tabStyle: CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: 'transparent',
  color: 'rgba(255, 255, 255, 0.55)',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11.5,
  letterSpacing: 0.5,
  fontFamily: 'inherit',
  fontWeight: 600,
  textTransform: 'uppercase',
}

const tabActiveStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.1)',
  color: '#fff',
}

const materialListStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  marginTop: 8,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
}

const materialRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  background: 'rgba(255, 255, 255, 0.05)',
  borderRadius: 4,
  cursor: 'pointer',
}

const swatchStyle: CSSProperties = {
  width: 28,
  height: 22,
  padding: 0,
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: 3,
  background: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
}

const materialNameStyle: CSSProperties = {
  flex: 1,
  fontSize: 12,
  color: 'rgba(255, 255, 255, 0.9)',
}

const materialHexStyle: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10,
  color: 'rgba(255, 255, 255, 0.45)',
  letterSpacing: 0.3,
}

const knobRowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 14,
  marginTop: 10,
  marginBottom: 10,
}

const knobWithReadoutStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
}

const readoutStyle: CSSProperties = {
  fontSize: 10,
  fontFamily: 'monospace',
  letterSpacing: 0.3,
  color: 'rgba(255, 255, 255, 0.6)',
  minWidth: 36,
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
  userSelect: 'none',
  WebkitUserSelect: 'none',
}

const stepperColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  marginTop: 8,
  marginBottom: 8,
}

const stepperRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 8px',
  background: 'rgba(255, 255, 255, 0.05)',
  borderRadius: 4,
  fontSize: 12,
  touchAction: 'none',
}

const stepperAxisStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 11,
  width: 12,
  textAlign: 'center',
}

const stepperBtnStyle: CSSProperties = {
  width: 24,
  height: 22,
  background: 'rgba(255, 255, 255, 0.08)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '20px',
  padding: 0,
  userSelect: 'none',
}

const stepperInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontFamily: 'monospace',
  fontSize: 12,
  letterSpacing: 0.3,
  textAlign: 'center',
  color: 'rgba(255, 255, 255, 0.92)',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.12)',
  borderRadius: 3,
  padding: '2px 4px',
  outline: 'none',
}

const stepperUnitStyle: CSSProperties = {
  opacity: 0.5,
  fontSize: 10,
  marginLeft: -2,
}

const hintStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.45,
  textAlign: 'center',
}

const btnGroupStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 12,
}

const miniBtnStyle: CSSProperties = {
  flex: 1,
  padding: '7px 8px',
  background: 'transparent',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'inherit',
  fontWeight: 500,
}

const resetBtnStyle: CSSProperties = {
  width: '100%',
  marginTop: 8,
  padding: '10px 8px',
  background: 'rgba(200, 90, 90, 0.22)',
  color: '#fff',
  border: '1px solid rgba(220, 110, 110, 0.5)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 600,
  letterSpacing: 0.3,
}


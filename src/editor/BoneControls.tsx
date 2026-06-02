import React, { CSSProperties, useEffect, useRef, useState } from 'react'

type Axis = 'x' | 'y' | 'z'

// Rotation: drag-based sphere knob
const SENSITIVITY = 0.008   // rad per pixel of horizontal drag

// Translation: stepper UI
const POS_STEP_M = 0.01              // 1 cm per click / wheel notch
// Multi-step burst: consecutive translation interactions inside this window
// count as ONE undo entry — keeps the undo stack from filling on wheel scrolls.
const UNDO_BURST_MS = 300

type PanelMode = 'bones' | 'style' | 'creator'
type EditorMaterial = { name: string; hex: string }

// Local mirror of CustomSlots (avoid cross-import for runtime).
type CustomSlots = {
  body: 'none' | 'body'
  helmet: 'none' | 'helmet'
  bodyArmor: 'none' | 'platebody'
  legArmor: 'none' | 'platelegs'
  rightHand: string  // 'none' | 'sword' | `library:${stem}`
  leftHand: string   // 'none' | 'shield' | `library:${stem}`
}
const DEFAULT_CUSTOM_SLOTS: CustomSlots = {
  body: 'body',
  helmet: 'helmet',
  bodyArmor: 'platebody',
  legArmor: 'platelegs',
  rightHand: 'sword',
  leftHand: 'shield',
}

export default function BoneControls() {
  const [panelMode, setPanelMode] = useState<PanelMode>('bones')
  const [selected, setSelected] = useState<string | null>(null)
  const [activeBones, setActiveBones] = useState<string[]>([])
  const [allBones, setAllBones] = useState<string[]>([])
  const [euler, setEuler] = useState<{ x: number; y: number; z: number } | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number; z: number } | null>(null)
  const [bodyPos, setBodyPos] = useState<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 })
  const commitBodyPosition = (x: number, y: number, z: number) => {
    ;(window as any).__editor?.setBodyPosition?.(x, y, z)
    setBodyPos({ x, y, z })
  }
  const [materials, setMaterials] = useState<EditorMaterial[]>([])
  // ─── Creator (slot-based) state ───
  const [customSlots, setCustomSlotsLocal] = useState<CustomSlots>(DEFAULT_CUSTOM_SLOTS)
  const [activeModelIdx, setActiveModelIdx] = useState(0)
  // Library weapons available for the Right/Left hand slots — populated
  // from the engine's weapon catalogue (axe_textured, double_edge_axe, …).
  const [libraryWeapons, setLibraryWeapons] = useState<Array<{ stem: string; kind: string }>>([])

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

  // Poll the selected bone's Euler angles + position + body world position
  // + active-model index each frame for the readouts / Creator gating.
  useEffect(() => {
    let rafId = 0
    const tick = () => {
      const ed = (window as any).__editor
      setEuler(ed?.getSelectedBoneEuler?.() ?? null)
      setPos(ed?.getSelectedBonePosition?.() ?? null)
      const bp = ed?.getBodyPosition?.()
      if (bp) setBodyPos(bp)
      const idx = ed?.getActiveModelIndex?.()
      if (typeof idx === 'number') setActiveModelIdx(idx)
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [])

  // Refresh local slot mirror + library-weapon catalogue when the Creator
  // tab opens. The engine is the source of truth for slot state.
  const refreshCustomSlots = () => {
    const ed = (window as any).__editor
    const slots = ed?.getCustomSlots?.() as CustomSlots | undefined
    if (slots) setCustomSlotsLocal(slots)
  }
  useEffect(() => {
    if (panelMode === 'creator') {
      refreshCustomSlots()
      const ed = (window as any).__editor
      // Pull the library weapon list once (the catalogue doesn't change
      // at runtime). Each entry has its stem + kind for grouping.
      const lib: Array<{ stem: string; kind: string }> | undefined =
        ed?.getWeaponLibrary?.() ?? ed?.weaponLibrary
      if (lib && Array.isArray(lib)) setLibraryWeapons(lib.map((w) => ({ stem: w.stem, kind: w.kind })))
    }
  }, [panelMode])

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
    // activeModelIdx dep: Style materials are now per-model, so switching
    // active model while in Style mode must re-fetch the new model's list.
  }, [panelMode, activeModelIdx])

  const onMaterialColor = (matName: string, hex: string) => {
    ;(window as any).__editor?.setEditorMaterialColor?.(matName, hex)
    setMaterials((curr) => curr.map((m) => (m.name === matName ? { ...m, hex } : m)))
  }

  const refreshMaterialsFromEngine = () => {
    const ed = (window as any).__editor
    const mats: EditorMaterial[] = ed?.getEditorMaterials?.() ?? []
    mats.sort((a, b) => a.name.localeCompare(b.name))
    setMaterials(mats)
  }
  const onSaveMaterials = () => {
    const ed = (window as any).__editor
    ed?.saveActiveEditorMaterials?.()
    // Saved snapshot now matches live — no visual refresh needed, but
    // re-pull defensively in case any rounding happened during snapshot.
    refreshMaterialsFromEngine()
  }
  const onRevertMaterials = () => {
    const ed = (window as any).__editor
    ed?.revertActiveEditorMaterials?.()
    refreshMaterialsFromEngine()
  }
  const onResetMaterials = () => {
    const ed = (window as any).__editor
    ed?.resetEditorMaterials?.()
    refreshMaterialsFromEngine()
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
        <button
          style={{ ...tabStyle, ...(panelMode === 'creator' ? tabActiveStyle : {}) }}
          onClick={() => setPanelMode('creator')}
        >
          Creator
        </button>
      </div>

      {/* Editable BODY POSITION — active model's WORLD coords (metres).
          Setting these values moves the spawn position (model.position)
          AND snaps root.position to it, so the model appears at the
          chosen location immediately. Each model can spawn anywhere. */}
      <div style={bodyPosBlockStyle}>
        <div style={bodyPosLabelStyle}>BODY POSITION (world)</div>
        <div style={bodyPosRowStyle}>
          <BodyPosInput axis="X" value={bodyPos.x} onCommit={(x) => commitBodyPosition(x, bodyPos.y, bodyPos.z)} />
          <BodyPosInput axis="Y" value={bodyPos.y} onCommit={(y) => commitBodyPosition(bodyPos.x, y, bodyPos.z)} />
          <BodyPosInput axis="Z" value={bodyPos.z} onCommit={(z) => commitBodyPosition(bodyPos.x, bodyPos.y, z)} />
          <span style={{ fontSize: 9, opacity: 0.4, marginLeft: 2 }}>m</span>
        </div>
      </div>

      {panelMode === 'creator' ? (
        <CreatorTab
          activeModelIdx={activeModelIdx}
          slots={customSlots}
          libraryWeapons={libraryWeapons}
          onChange={refreshCustomSlots}
        />
      ) : panelMode === 'style' ? (
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
          <div style={styleBtnRowStyle}>
            <button
              style={styleBtnStyle}
              onClick={onSaveMaterials}
              title="Persist current colours to library.json"
            >
              Save
            </button>
            <button
              style={styleBtnStyle}
              onClick={onRevertMaterials}
              title="Restore the last saved colours for this model"
            >
              Revert
            </button>
            <button
              style={styleBtnStyle}
              onClick={onResetMaterials}
              title="Restore the baked-in GLB colours (factory defaults)"
            >
              Reset
            </button>
          </div>
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
          <div style={subtitleStyle}>hips offset · feet stay planted (cm)</div>
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
        Reset current model
      </button>
      <button
        style={{ ...resetBtnStyle, marginTop: 4 }}
        onClick={() => (window as any).__editor?.resetAll()}
      >
        Reset all models
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

// ──────────────────────────────────────────────────────────────────
// CreatorTab — slot-based wardrobe for the Custom (Model 3) knight.
// Six slots: Body / Helmet / Body Armor / Leg Armor / Right Hand /
// Left Hand. Each slot picks ONE option from a small fixed list; the
// engine flips mesh visibility (or attaches a library weapon) to match.
// Replaces the prior per-bone clone Creator that broke on the v3 knight.
// ──────────────────────────────────────────────────────────────────
const CUSTOM_MODEL_IDX = 2

// Pretty labels for the right-side panel sections.
const SLOT_LABELS: Record<keyof CustomSlots, string> = {
  body: 'Body',
  helmet: 'Helmet',
  bodyArmor: 'Body Armor',
  legArmor: 'Leg Armor',
  rightHand: 'Right Hand',
  leftHand: 'Left Hand',
}

function CreatorTab({
  activeModelIdx,
  slots,
  libraryWeapons,
  onChange,
}: {
  activeModelIdx: number
  slots: CustomSlots
  libraryWeapons: Array<{ stem: string; kind: string }>
  onChange: () => void
}) {
  if (activeModelIdx !== CUSTOM_MODEL_IDX) {
    return (
      <div style={{ flex: 1, padding: 12, opacity: 0.7, fontSize: 12 }}>
        Creator only operates on the <b>Custom</b> model.
        <br />
        <br />
        Switch the active model to <b>Custom</b> in the left panel, then come back here.
      </div>
    )
  }

  const setSlot = (slot: keyof CustomSlots, value: string) => {
    ;(window as any).__editor?.setCustomSlot?.(slot, value)
    onChange()
  }
  const resetAll = () => {
    ;(window as any).__editor?.resetCustomSlots?.()
    onChange()
  }

  // Hand slots get None + native + every library weapon. Body/armor slots
  // are simple on/off toggles.
  const handOptions = (native: string, nativeLabel: string) => [
    { value: 'none', label: 'None' },
    { value: native, label: nativeLabel },
    ...libraryWeapons.map((w) => ({
      value: `library:${w.stem}`,
      label: `${w.stem} (${w.kind})`,
    })),
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto', padding: '4px 2px 8px' }}>
      <SlotToggleRow
        label={SLOT_LABELS.body}
        on={slots.body !== 'none'}
        onChange={(on) => setSlot('body', on ? 'body' : 'none')}
      />
      <SlotToggleRow
        label={SLOT_LABELS.helmet}
        on={slots.helmet !== 'none'}
        onChange={(on) => setSlot('helmet', on ? 'helmet' : 'none')}
      />
      <SlotToggleRow
        label={SLOT_LABELS.bodyArmor}
        on={slots.bodyArmor !== 'none'}
        onChange={(on) => setSlot('bodyArmor', on ? 'platebody' : 'none')}
      />
      <SlotToggleRow
        label={SLOT_LABELS.legArmor}
        on={slots.legArmor !== 'none'}
        onChange={(on) => setSlot('legArmor', on ? 'platelegs' : 'none')}
      />
      <SlotSelectRow
        label={SLOT_LABELS.rightHand}
        value={slots.rightHand}
        options={handOptions('sword', 'Sword (native)')}
        onChange={(v) => setSlot('rightHand', v)}
      />
      <SlotSelectRow
        label={SLOT_LABELS.leftHand}
        value={slots.leftHand}
        options={handOptions('shield', 'Shield (native)')}
        onChange={(v) => setSlot('leftHand', v)}
      />
      <button style={resetBtnStyle} onClick={resetAll}>Reset to default kit</button>
      <div style={{ fontSize: 10, opacity: 0.45, marginTop: 8 }}>
        Recolor each slot's materials via the <b>Style</b> tab — colours apply
        independently to Custom.
      </div>
    </div>
  )
}

function SlotToggleRow({
  label, on, onChange,
}: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label style={slotRowStyle}>
      <span style={slotLabelStyle}>{label}</span>
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={slotCheckboxStyle}
      />
      <span style={slotStatusStyle}>{on ? 'on' : 'off'}</span>
    </label>
  )
}

function SlotSelectRow({
  label, value, options, onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <label style={slotRowStyle}>
      <span style={slotLabelStyle}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={slotSelectStyle}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: '#1c1f24', color: '#fff' }}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// Body-position cell: axis label + editable number. Holds local draft
// state while focused so the per-frame rAF tick doesn't overwrite mid-type.
function BodyPosInput({
  axis, value, onCommit,
}: { axis: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value.toFixed(2))
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value.toFixed(2)) }, [value, focused])
  return (
    <label style={bodyPosCellStyle}>
      <span style={bodyPosAxisStyle}>{axis}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { setFocused(true); e.target.select() }}
        onBlur={() => {
          setFocused(false)
          const n = parseFloat(text)
          if (Number.isFinite(n)) onCommit(n)
          else setText(value.toFixed(2))
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setText(value.toFixed(2)); (e.target as HTMLInputElement).blur() }
        }}
        style={bodyPosInputStyle}
      />
    </label>
  )
}

const panelStyle: CSSProperties = {
  position: 'fixed',
  right: 0,
  top: 0,
  // Leave room for the CameraToggle pill at right:20, bottom:20 (~40px tall
  // plus its own 20px gap) so the panel never overlaps the camera selector.
  bottom: 76,
  width: 240,
  padding: 14,
  background: 'rgba(20, 22, 25, 0.92)',
  color: '#fff',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 13,
  zIndex: 9,
  borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(6px)',
  // Outer panel does NOT scroll — inner sections do. Without this, the
  // Creator tab's parts list created a double scrollbar (one on the
  // panel, one on the list) and chunks of UI would scroll off-screen.
  overflow: 'hidden',
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

const bodyPosBlockStyle: CSSProperties = {
  padding: '6px 8px',
  marginBottom: 10,
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 4,
}

const bodyPosLabelStyle: CSSProperties = {
  fontSize: 9,
  letterSpacing: 1,
  textTransform: 'uppercase',
  opacity: 0.55,
  marginBottom: 4,
  fontWeight: 600,
}

const bodyPosRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'monospace',
  fontSize: 12,
}

const bodyPosCellStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flex: 1,
  minWidth: 0,
}

const bodyPosInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '2px 4px',
  fontFamily: 'monospace',
  fontSize: 11,
  outline: 'none',
  textAlign: 'right',
}

const bodyPosAxisStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  fontWeight: 700,
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

// Style-tab Save/Revert/Reset trio — sit side-by-side under the
// material list, equal width.
const styleBtnRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginTop: 8,
}
const styleBtnStyle: CSSProperties = {
  flex: 1,
  padding: '10px 4px',
  background: 'rgba(80, 100, 120, 0.25)',
  color: '#fff',
  border: '1px solid rgba(130, 150, 180, 0.5)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 600,
  letterSpacing: 0.3,
}

const slotRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 6px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  cursor: 'pointer',
}
const slotLabelStyle: CSSProperties = {
  flex: '0 0 96px',
  fontSize: 12,
  letterSpacing: 0.2,
}
const slotCheckboxStyle: CSSProperties = {
  width: 16,
  height: 16,
  cursor: 'pointer',
}
const slotStatusStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  fontFamily: 'monospace',
  textTransform: 'uppercase',
}
const slotSelectStyle: CSSProperties = {
  flex: '1 1 100%',
  background: '#1c1f24',
  color: '#fff',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 3,
  fontSize: 11,
  padding: '4px 6px',
  fontFamily: 'inherit',
}


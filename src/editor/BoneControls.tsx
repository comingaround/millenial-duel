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

// Mirror of CreatorPart from editor-scene.ts (avoid cross-import cycle).
type CreatorShape = 'sphere' | 'box' | 'cylinder' | 'capsule' | 'clone'
type CreatorPart = {
  id: string
  boneName: string
  shape: CreatorShape
  scale: [number, number, number]
  offset: [number, number, number]
  rotation: [number, number, number]
  color: string
  sourceMeshName?: string
  groupMeshNames?: string[]
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
  // ─── Creator state ───
  const [creatorParts, setCreatorParts] = useState<CreatorPart[]>([])
  const [activeModelIdx, setActiveModelIdx] = useState(0)
  // addTarget is a string formatted as either "bone:Head" or "prop:Sword".
  // Single dropdown with both kinds; the prefix tells the engine which
  // path to dispatch on Add.
  const [addTarget, setAddTarget] = useState<string>('bone:Head')
  const [creatorTargets, setCreatorTargets] = useState<{
    bones: string[]
    props: Array<{ stem: string; members: string[] }>
    weapons: Array<{ stem: string; members: string[]; kind: string }>
  }>({ bones: [], props: [], weapons: [] })

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

  // Refresh the local creator-parts mirror from the engine when entering
  // the Creator tab (and whenever an op modifies it).
  const refreshCreatorParts = () => {
    const ed = (window as any).__editor
    setCreatorParts(ed?.getCreatorParts?.() ?? [])
  }
  useEffect(() => {
    if (panelMode === 'creator') {
      refreshCreatorParts()
      // Refresh the bone+prop target list every time the Creator tab
      // opens — source meshes don't change at runtime but lazy-init avoids
      // running the enumeration before the engine is ready.
      const ed = (window as any).__editor
      const t = ed?.getCreatorTargets?.()
      if (t) setCreatorTargets(t)
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
          parts={creatorParts}
          addTarget={addTarget}
          setAddTarget={setAddTarget}
          creatorTargets={creatorTargets}
          activeBones={activeBones}
          onChange={refreshCreatorParts}
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
// CreatorTab — build the Custom model (Model 3) by cloning body parts
// + props (sword, shield) from Model 1. Gated to active model = 2.
// Procedural primitives (sphere/box/cylinder/capsule) were dropped from
// the Add UI — the clone path covers all real use cases. Legacy parts
// in library.json still render via creator-parts.ts.
// ──────────────────────────────────────────────────────────────────
const CUSTOM_MODEL_IDX = 2

function CreatorTab({
  activeModelIdx,
  parts,
  addTarget,
  setAddTarget,
  creatorTargets,
  activeBones,
  onChange,
}: {
  activeModelIdx: number
  parts: CreatorPart[]
  addTarget: string
  setAddTarget: (t: string) => void
  creatorTargets: {
    bones: string[]
    props: Array<{ stem: string; members: string[] }>
    weapons: Array<{ stem: string; members: string[]; kind: string }>
  }
  activeBones: string[]
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

  // Targets: bones first, then prop stems. Encoded as "bone:Name" or
  // "prop:stem" — for groups, the engine resolves member meshes by stem.
  // Bone list is the ACTIVE subset (19 combat-relevant bones) — fingers/
  // toes/IK helpers aren't useful clone targets, so they're hidden.
  const activeBoneSet = new Set(activeBones)
  const boneOptions = (creatorTargets.bones.length ? creatorTargets.bones : activeBones)
    .filter((b) => activeBoneSet.has(b))
  const propOptions = creatorTargets.props
  const weaponOptions = creatorTargets.weapons
  const propByStem = new Map(propOptions.map((p) => [p.stem, p]))
  const weaponByStem = new Map(weaponOptions.map((w) => [w.stem, w]))
  const onAdd = () => {
    const ed = (window as any).__editor
    if (addTarget.startsWith('weapon:')) {
      const stem = addTarget.slice(7)
      const wpn = weaponByStem.get(stem)
      if (!wpn) return
      ed?.addCreatorWeaponClone?.(stem, wpn.members)
    } else if (addTarget.startsWith('prop:')) {
      const stem = addTarget.slice(5)
      const prop = propByStem.get(stem)
      if (!prop) return
      // Single-primitive → flat prop clone. Multi-primitive → group.
      if (prop.members.length > 1) {
        ed?.addCreatorPropGroupClone?.(stem, prop.members)
      } else {
        ed?.addCreatorPropClone?.(prop.members[0])
      }
    } else {
      const bone = addTarget.startsWith('bone:') ? addTarget.slice(5) : addTarget
      ed?.addCreatorPart?.('clone', bone)
    }
    onChange()
  }

  // Bones grouped by body part via the existing categorize() helper.
  // Filter out empty groups + the "Other" catch-all when it's empty.
  const boneGroups = categorize(boneOptions).filter((g) => g.bones.length > 0)
  // Weapons grouped by type (sword/shield/other). Keyword match on stem
  // — works for the current rig where weapon mesh names contain "sword"
  // or "shield". When new weapon types arrive (axe, bow, …), add a
  // matcher here.
  const weaponSubcats: Array<{ name: string; props: typeof propOptions }> = [
    { name: 'Sword',  props: propOptions.filter((p) => /sword/i.test(p.stem)) },
    { name: 'Shield', props: propOptions.filter((p) => /shield/i.test(p.stem)) },
    { name: 'Other',  props: propOptions.filter((p) => !/sword|shield/i.test(p.stem)) },
  ].filter((s) => s.props.length > 0)

  // Weapon-library items grouped by `kind` (axe/sword/bow/etc.). The
  // engine already classifies them at scene init via the WEAPON_CATALOGUE.
  const libraryByKind = new Map<string, typeof weaponOptions>()
  for (const w of weaponOptions) {
    const k = w.kind || 'other'
    if (!libraryByKind.has(k)) libraryByKind.set(k, [])
    libraryByKind.get(k)!.push(w)
  }
  const libraryKindOrder = ['sword', 'axe', 'dagger', 'mace', 'hammer', 'bow', 'shield', 'other']
  const librarySubcats = libraryKindOrder
    .filter((k) => libraryByKind.has(k))
    .map((k) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), items: libraryByKind.get(k)! }))

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflowY: 'auto' }}>
      <div style={creatorAddRowStyle}>
        <select
          value={addTarget}
          onChange={(e) => setAddTarget(e.target.value)}
          style={{ ...creatorSelectStyle, flex: '1 1 100%' }}
        >
          {/* True 3-level nesting in a native <select> is impossible
              (browsers ignore nested optgroups + style optgroup labels
              via OS theme). We emulate it with disabled separator rows
              and unicode-space indentation on each level:
                ▸ Category            (disabled, no indent)
                  ▸ Subcategory       (disabled, 1 indent)
                      Item            (selectable, 2 indents) */}
          {boneGroups.length > 0 ? (
            <option disabled value="" style={creatorCategoryStyle}>
              {'▸ Bones'}
            </option>
          ) : null}
          {boneGroups.map((g) => (
            <React.Fragment key={`bg-${g.name}`}>
              <option disabled value="" style={creatorSubcategoryStyle}>
                {`   ▸ ${g.name}`}
              </option>
              {g.bones.map((b) => (
                <option key={`b-${b}`} value={`bone:${b}`} style={creatorItemStyle}>
                  {`        ${b}`}
                </option>
              ))}
            </React.Fragment>
          ))}
          {weaponSubcats.length > 0 ? (
            <option disabled value="" style={creatorCategoryStyle}>
              {'▸ Weapons'}
            </option>
          ) : null}
          {weaponSubcats.map((s) => (
            <React.Fragment key={`wg-${s.name}`}>
              <option disabled value="" style={creatorSubcategoryStyle}>
                {`   ▸ ${s.name}`}
              </option>
              {s.props.map((p) => (
                <option key={`p-${p.stem}`} value={`prop:${p.stem}`} style={creatorItemStyle}>
                  {`        ${p.stem}${p.members.length > 1 ? ` (${p.members.length} parts)` : ''}`}
                </option>
              ))}
            </React.Fragment>
          ))}
          {/* Third category: weapon library (GLBs from /models/weapons/). */}
          {librarySubcats.length > 0 ? (
            <option disabled value="" style={creatorCategoryStyle}>
              {'▸ Weapons (library)'}
            </option>
          ) : null}
          {librarySubcats.map((s) => (
            <React.Fragment key={`lg-${s.name}`}>
              <option disabled value="" style={creatorSubcategoryStyle}>
                {`   ▸ ${s.name}`}
              </option>
              {s.items.map((w) => (
                <option key={`w-${w.stem}`} value={`weapon:${w.stem}`} style={creatorItemStyle}>
                  {`        ${w.stem}${w.members.length > 1 ? ` (${w.members.length} parts)` : ''}`}
                </option>
              ))}
            </React.Fragment>
          ))}
        </select>
        <button style={creatorAddBtnStyle} onClick={onAdd}>+ Add clone</button>
      </div>

      <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 6 }}>
        {parts.length} part{parts.length === 1 ? '' : 's'} on Custom model
      </div>

      {parts.length === 0 ? (
        <div style={{ fontSize: 11, opacity: 0.45 }}>
          (Pick a body bone or prop → Add clone)
        </div>
      ) : (
        parts.map((p) => (
          <PartRow key={p.id} part={p} bones={boneOptions} onChange={onChange} />
        ))
      )}
    </div>
  )
}

function PartRow({ part, bones, onChange }: { part: CreatorPart; bones: string[]; onChange: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const update = (patch: Partial<CreatorPart>) => {
    ;(window as any).__editor?.updateCreatorPart?.(part.id, patch)
    onChange()
  }
  const del = () => {
    ;(window as any).__editor?.deleteCreatorPart?.(part.id)
    onChange()
  }
  // Scale shown in centimetres for consistency with offset.
  const sx = part.scale[0] * 100
  const sy = part.scale[1] * 100
  const sz = part.scale[2] * 100
  const ox = part.offset[0] * 100
  const oy = part.offset[1] * 100
  const oz = part.offset[2] * 100

  // Bone list includes the part's current bone even if it's not in
  // ACTIVE_BONES (e.g. legacy data), so the dropdown stays selectable.
  const dropdownBones = bones.includes(part.boneName) ? bones : [part.boneName, ...bones]

  // Label: prop name (single OR group stem) or fallback to shape.
  const kindLabel = part.sourceMeshName
    ? `${part.sourceMeshName}${part.groupMeshNames ? ` (${part.groupMeshNames.length})` : ''}`
    : part.shape
  return (
    <div style={partRowStyle}>
      {/* Header row 1: chevron + title + delete. Click chevron OR title
          to toggle accordion. Stacked layout: title gets its own row. */}
      <div style={partHeaderRow1Style}>
        <span
          style={partChevronStyle}
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? '▼' : '▶'}
        </span>
        <span
          style={partTitleStyle}
          onClick={() => setExpanded((v) => !v)}
        >
          {kindLabel}
        </span>
        <span style={partDelStyle} onClick={del} title="Delete">×</span>
      </div>
      {/* Header row 2: bone retarget — always visible so user can move
          a collapsed part between bones without expanding. */}
      <div style={partHeaderRow2Style}>
        <span style={partBoneLabelStyle}>bone</span>
        <select
          value={part.boneName}
          onChange={(e) => update({ boneName: e.target.value })}
          style={{ ...creatorSelectStyle, flex: '1 1 100%' }}
        >
          {dropdownBones.map((b) => (
            <option key={b} value={b} style={{ background: '#1c1f24', color: '#fff' }}>
              {b}
            </option>
          ))}
        </select>
      </div>
      {/* Accordion body — size / offset / rotation / color. */}
      {expanded ? (
        <>
          <PartTripleRow
            label={part.shape === 'clone' ? 'size %' : 'size'}
            x={sx} y={sy} z={sz}
            onSet={(axis, cm) => {
              const next: [number, number, number] = [...part.scale]
              next[axis] = Math.max(0.5, cm) / 100
              update({ scale: next })
            }}
          />
          <PartTripleRow
            label="offset"
            x={ox} y={oy} z={oz}
            onSet={(axis, cm) => {
              const next: [number, number, number] = [...part.offset]
              next[axis] = cm / 100
              update({ offset: next })
            }}
          />
          <PartTripleRow
            label="rot°"
            x={part.rotation[0]} y={part.rotation[1]} z={part.rotation[2]}
            onSet={(axis, deg) => {
              const next: [number, number, number] = [...part.rotation]
              next[axis] = deg
              update({ rotation: next })
            }}
          />
          <div style={partColorRowStyle}>
            <span style={{ fontSize: 10, opacity: 0.55, width: 38 }}>color</span>
            <input
              type="color"
              value={part.color}
              onChange={(e) => update({ color: e.target.value })}
              style={partSwatchStyle}
            />
            <span style={{ fontFamily: 'monospace', fontSize: 9, opacity: 0.45 }}>
              {part.color.toUpperCase()}
            </span>
          </div>
        </>
      ) : null}
    </div>
  )
}

function PartTripleRow({
  label, x, y, z, onSet,
}: {
  label: string
  x: number; y: number; z: number
  onSet: (axis: 0 | 1 | 2, value: number) => void
}) {
  const fmt = (n: number) => Number.isInteger(n) ? `${n}` : n.toFixed(1)
  return (
    <div style={partTripleRowStyle}>
      <span style={{ fontSize: 10, opacity: 0.55, width: 38 }}>{label}</span>
      <span style={partAxisLabelStyle}>X</span>
      <PartNumInput value={fmt(x)} onCommit={(v) => onSet(0, v)} />
      <span style={partAxisLabelStyle}>Y</span>
      <PartNumInput value={fmt(y)} onCommit={(v) => onSet(1, v)} />
      <span style={partAxisLabelStyle}>Z</span>
      <PartNumInput value={fmt(z)} onCommit={(v) => onSet(2, v)} />
    </div>
  )
}

function PartNumInput({
  value, onCommit,
}: { value: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  useEffect(() => { if (!focused) setText(value) }, [value, focused])
  return (
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
        else setText(value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') { setText(value); (e.target as HTMLInputElement).blur() }
      }}
      style={partNumInputStyle}
    />
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



const creatorAddRowStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 10,
  alignItems: 'center',
  flexWrap: 'wrap',     // wrap to next line if panel is narrow
  minWidth: 0,
}
const creatorSelectStyle: CSSProperties = {
  flex: '1 1 80px',     // share space, shrink below content width when needed
  minWidth: 0,
  maxWidth: '100%',
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '4px 6px',
  fontFamily: 'inherit',
  fontSize: 11,
  outline: 'none',
}
const creatorAddBtnStyle: CSSProperties = {
  flex: '0 0 auto',     // fixed width — never gets pushed off the row
  background: 'rgba(95, 130, 200, 0.55)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.15)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 11,
  fontFamily: 'inherit',
  fontWeight: 500,
  cursor: 'pointer',
}
// Tree-style category headers inside the dropdown. Native <optgroup>
// labels use the OS theme and don't pick up dark-mode colours, so we
// build the visual hierarchy from regular <option> rows: 3 styles =
// 3 levels of nesting (category > subcategory > item).
const creatorCategoryStyle: CSSProperties = {
  background: '#0a0c0f',
  color: '#cbd5e1',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.6,
}
const creatorSubcategoryStyle: CSSProperties = {
  background: '#13161b',
  color: '#94a3b8',
  fontSize: 10,
  fontWeight: 600,
}
const creatorItemStyle: CSSProperties = {
  background: '#1c1f24',
  color: '#fff',
  fontSize: 11,
}
const partRowStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 4,
  padding: '6px 8px',
  marginBottom: 6,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}
const partHeaderRow1Style: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  marginBottom: 2,
}
const partChevronStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: 9,
  opacity: 0.65,
  width: 12,
  textAlign: 'center',
  userSelect: 'none',
  flexShrink: 0,
}
const partTitleStyle: CSSProperties = {
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const partHeaderRow2Style: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  marginBottom: 4,
}
const partBoneLabelStyle: CSSProperties = {
  fontSize: 10,
  opacity: 0.55,
  width: 30,
  flexShrink: 0,
}
const partDelStyle: CSSProperties = {
  cursor: 'pointer',
  opacity: 0.5,
  fontWeight: 700,
  padding: '0 4px',
  flexShrink: 0,
}
const partTripleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 3,
}
const partAxisLabelStyle: CSSProperties = {
  fontSize: 9,
  opacity: 0.55,
  fontWeight: 700,
  width: 8,
  textAlign: 'center',
  flexShrink: 0,
}
const partNumInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(255, 255, 255, 0.07)',
  color: '#fff',
  border: '1px solid rgba(255, 255, 255, 0.18)',
  borderRadius: 3,
  padding: '2px 4px',
  fontFamily: 'monospace',
  fontSize: 10,
  outline: 'none',
  textAlign: 'right',
}
const partColorRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 2,
}
const partSwatchStyle: CSSProperties = {
  width: 28,
  height: 18,
  padding: 0,
  border: '1px solid rgba(255, 255, 255, 0.25)',
  borderRadius: 3,
  background: 'transparent',
  cursor: 'pointer',
  flexShrink: 0,
}

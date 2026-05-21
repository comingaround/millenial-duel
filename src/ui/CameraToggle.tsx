import { useState } from 'react'

type Mode = 'free' | 'locked'

export default function CameraToggle() {
  const [mode, setMode] = useState<Mode>('free')

  const toggle = () => {
    const next: Mode = mode === 'free' ? 'locked' : 'free'
    setMode(next)
    ;(window as any).__bjs?.setCameraMode?.(next)
  }

  return (
    <button
      onClick={toggle}
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        padding: '10px 18px',
        background: 'rgba(0, 0, 0, 0.62)',
        color: '#fff',
        border: '1px solid rgba(255, 255, 255, 0.35)',
        borderRadius: 6,
        cursor: 'pointer',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: 0.3,
        backdropFilter: 'blur(4px)',
        zIndex: 10,
      }}
    >
      Camera: {mode === 'free' ? 'Free Roam' : 'Locked (FPS)'}
    </button>
  )
}

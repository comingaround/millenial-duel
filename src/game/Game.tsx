import { useCallback, useEffect, useRef } from 'react'
import { createEngine } from './engine'

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const onSceneReady = useCallback(() => {
    // hook for future logic (player ready, etc.)
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return
    const cleanup = createEngine(canvasRef.current, onSceneReady)
    return cleanup
  }, [onSceneReady])

  return <canvas ref={canvasRef} />
}

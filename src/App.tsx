import { useState } from 'react'
import Game from './game/Game'
import CameraToggle, { CameraMode } from './ui/CameraToggle'
import EditorPanel from './editor/EditorPanel'
import BoneControls from './editor/BoneControls'

export default function App() {
  const [mode, setMode] = useState<CameraMode>('free')
  return (
    <>
      <Game />
      <CameraToggle mode={mode} onModeChange={setMode} />
      {mode === 'editor' && <EditorPanel />}
      {mode === 'editor' && <BoneControls />}
    </>
  )
}

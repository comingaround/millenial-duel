import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { animationSaverPlugin } from './vite-plugins/animation-saver'

export default defineConfig({
  plugins: [react(), animationSaverPlugin()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
})

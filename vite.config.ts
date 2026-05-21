import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,        // bind to 0.0.0.0 → exposes a Network URL
    port: 5173,
    strictPort: true,  // fail rather than silently shift port
  },
})

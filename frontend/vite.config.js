import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BACKEND_PORT lets a second copy run next to the default one (e.g. BACKEND_PORT=8777 npm run dev)
const backend = `http://localhost:${process.env.BACKEND_PORT || 8766}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/upstox-api': {
        target: backend,
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
      },
      '/nlp-api': {
        target: backend,
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        rewrite: (path) => path.replace(/^\/nlp-api/, ''),
      },
      '/api': {
        target: backend,
        changeOrigin: true,
        timeout: 60000,
        proxyTimeout: 60000,   // /api/catalysts can take a while on a cold cache
      }
    }
  }
})

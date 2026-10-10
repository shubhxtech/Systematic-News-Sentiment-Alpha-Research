import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/upstox-api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
      },
      '/nlp-api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
        rewrite: (path) => path.replace(/^\/nlp-api/, ''),
      },
      '/api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        timeout: 30000,
        proxyTimeout: 30000,
      }
    }
  }
})

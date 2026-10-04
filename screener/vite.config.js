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
      },
      '/nlp-api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nlp-api/, ''),
      },
      '/api': {
        target: 'http://localhost:8766',
        changeOrigin: true,
      }
    }
  }
})

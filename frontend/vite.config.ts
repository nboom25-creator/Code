/// <reference types="vite/client" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'AEGIS_')
  // The API is proxied so the browser sees one origin. That keeps the session
  // cookie first-party and means no broker credential or API key ever needs to
  // exist in frontend code. In production nginx does the same job.
  const proxy = {
    '/api': {
      target: env.AEGIS_API_URL ?? 'http://127.0.0.1:8000',
      changeOrigin: true,
    },
  }
  return {
  plugins: [react()],
  server: {
    port: 5173,
    proxy,
  },
  // `vite preview` serves the production build. It needs the same proxy, or the
  // built app cannot reach the API and the preview is not a real rehearsal.
  preview: {
    port: 5173,
    proxy,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          charts: ['recharts'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  }
})

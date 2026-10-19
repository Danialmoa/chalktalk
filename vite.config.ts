import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Cross-origin isolation lets the voice model run on several threads: about twice as fast, so the voice
// keeps up with the lesson. server/main.py sends the same headers in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['kokoro-js'],
  },
  // The voice worker pulls in onnxruntime, which loads parts of itself on demand; iife workers can't split.
  worker: { format: 'es' },
  define: {
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  server: {
    headers: isolation,
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  preview: { headers: isolation },
})

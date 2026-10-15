import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backboardKey = env.BACKBOARD_API_KEY

  return {
    plugins: [react()],
    optimizeDeps: {
      exclude: ['kokoro-js'],
    },
    define: {
      'process.env.IS_PREACT': JSON.stringify('false'),
    },
    server: {
      proxy: {
        '/backboard': {
          target: 'https://app.backboard.io/api',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/backboard/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (backboardKey) proxyReq.setHeader('X-API-Key', backboardKey)
            })
          },
        },
      },
    },
  }
})

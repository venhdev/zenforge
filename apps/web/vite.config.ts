/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
const daemonPort = nodeEnv?.PORT || nodeEnv?.VITE_API_PORT || '1123'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@xyflow/react') || id.includes('@dagrejs/dagre')) return 'vendor-flow'
          if (id.includes('dockview')) return 'vendor-dockview'
          if (id.includes('@xterm/')) return 'vendor-xterm'
          if (id.includes('lucide-react')) return 'vendor-ui'
          if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react'
          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${daemonPort}`,
        changeOrigin: true,
      },
    },
  },
})

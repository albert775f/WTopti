import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

const gitCommit = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
})();

// https://vite.dev/config/
export default defineConfig({
  define: {
    __GIT_COMMIT__: JSON.stringify(gitCommit),
  },
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

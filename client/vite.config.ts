import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Repo root: gives the client access to shared/ (maps, protocol) and the root .env.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

const SERVER_URL = process.env.DEV_SERVER_URL ?? 'http://localhost:8080'

export default defineConfig({
  // Only VITE_* keys from the root .env reach the browser.
  envDir: REPO_ROOT,
  server: {
    fs: { allow: [REPO_ROOT] },
    proxy: {
      '/api': SERVER_URL,
      '/actuator': SERVER_URL,
      '/ws': { target: SERVER_URL, ws: true },
    },
  },
})

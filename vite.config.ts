import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Served from https://lidesheng926.github.io/tracelens/ on GitHub Pages, so the
// production build needs that sub-path as its base. Local dev stays at root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tracelens/' : '/',
  plugins: [react(), tailwindcss()],
}))

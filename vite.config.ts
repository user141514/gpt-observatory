import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      ignored: ['**/data/**', '**/obsidian-vault/**'],
    },
    proxy: {
      '/api': 'http://127.0.0.1:4317',
    },
  },
})

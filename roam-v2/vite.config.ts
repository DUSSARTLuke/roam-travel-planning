import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { roamPwa } from './pwa/plugin.ts'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), roamPwa()],
})

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('../../src/shared', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 52822 },
  build: { outDir: fileURLToPath(new URL('../../out/demo/frontend-foundation', import.meta.url)) }
})

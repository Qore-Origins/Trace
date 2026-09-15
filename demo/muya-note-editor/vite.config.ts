import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  root: demoRoot,
  base: './',
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: true
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 52818
  },
  build: {
    outDir: fileURLToPath(new URL('./out/demo/muya-note-editor', `file:///${projectRoot.replaceAll('\\', '/')}/`)),
    emptyOutDir: true
  }
})

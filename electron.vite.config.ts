import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    esbuild: {
      tsconfigRaw: {
        compilerOptions: {
          experimentalDecorators: true,
          useDefineForClassFields: true
        }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id): string | undefined {
            const moduleId = id.replaceAll('\\', '/')
            if (!moduleId.includes('/node_modules/')) return undefined
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(moduleId)) return 'vendor-react'
            if (/\/node_modules\/(@ant-design|@rc-component|antd|rc-[^/]+)\//.test(moduleId)) return 'vendor-antd'
            if (/\/node_modules\/@dnd-kit\//.test(moduleId)) return 'vendor-dnd'
            return undefined
          }
        }
      }
    }
  }
})

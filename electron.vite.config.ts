import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// electron-vite's isolated-entry reporter does not guard its TTY cursor calls
// with isTTY, so piped build logs need no-op fallbacks for missing methods.
const terminalOutput = process.stdout
if (typeof terminalOutput.clearLine !== 'function') terminalOutput.clearLine = () => true
if (typeof terminalOutput.cursorTo !== 'function') terminalOutput.cursorTo = () => true
if (typeof terminalOutput.moveCursor !== 'function') terminalOutput.moveCursor = () => true

export default defineConfig({
  main: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          'agent-approval': resolve(__dirname, 'src/preload/agent-approval.ts')
        }
      },
      isolatedEntries: true,
      externalizeDeps: false
    }
  },
  renderer: {
    optimizeDeps: {
      include: ['@muyajs/core', '@muyajs/core/utils/diagram/index.js']
    },
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
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          'agent-approval': resolve(__dirname, 'src/renderer/agent-approval.html')
        },
        output: {
          onlyExplicitManualChunks: true,
          manualChunks(id): string | undefined {
            const moduleId = id.replaceAll('\\', '/')
            if (moduleId.endsWith('/src/renderer/src/stores/workspace-tabs-store.ts')) return 'workspace-tabs'
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

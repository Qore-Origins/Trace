import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// electron-vite's isolated-entry reporter does not guard its TTY cursor calls
// with isTTY. Only piped builds need missing methods supplied; preserve real TTY behavior.
export function configureReporterStdout(command: string, output: NodeJS.WriteStream = process.stdout): void {
  if (command !== 'build' || output.isTTY) return
  if (typeof output.clearLine !== 'function') output.clearLine = () => true
  if (typeof output.cursorTo !== 'function') output.cursorTo = () => true
  if (typeof output.moveCursor !== 'function') output.moveCursor = () => true
}

const electronViteConfig = {
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
          manualChunks(id: string): string | undefined {
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
}

export default defineConfig(({ command }) => {
  configureReporterStdout(command)
  return electronViteConfig
})

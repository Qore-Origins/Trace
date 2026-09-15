import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environment: 'node'
  }
})

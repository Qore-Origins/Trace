import { defineConfig } from 'vitest/config'
import type { Plugin } from 'esbuild'
import { dirname, resolve } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'

const muyaRendererIntegrationPlugin: Plugin = {
  name: 'trace-test-muya-renderer-integration',
  setup(build) {
    build.onResolve({ filter: /\.(?:css|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf)(?:\?.*)?$/i }, ({ path }) => {
      return { path, namespace: 'trace-test-static-asset' }
    })
    build.onLoad({ filter: /.*/, namespace: 'trace-test-static-asset' }, () => ({
      contents: 'export default ""',
      loader: 'js'
    }))
    build.onResolve({ filter: /^plantuml-encoder$/ }, () => ({
      path: resolve(__dirname, 'node_modules/plantuml-encoder/browser-index.js')
    }))
    build.onLoad({ filter: /[\\/]utils[\\/]prism[\\/]loadLanguage\.ts$/ }, async ({ path }) => {
      const expectedPath = resolve(__dirname, 'vendor/muya/src/utils/prism/loadLanguage.ts')
      if (resolve(path) !== expectedPath) return undefined

      const source = await readFile(path, 'utf8')
      const prismComponentsDirectory = resolve(__dirname, 'node_modules/prismjs/components')
      const prismLanguageFiles = (await readdir(prismComponentsDirectory))
        .filter((fileName) => /^prism-.+\.js$/.test(fileName))
        .sort()
      const prismLanguageModules = prismLanguageFiles
        .map((fileName) => {
          const modulePath = `../../../../../node_modules/prismjs/components/${fileName}`
          return `${JSON.stringify(modulePath)}: () => import(${JSON.stringify(modulePath)})`
        })
        .join(',\n')
      const globCall = /import\.meta\.glob\(\s*(['"])\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/node_modules\/prismjs\/components\/prism-\*\.js\1\s*,?\s*\)/
      if (!globCall.test(source)) {
        throw new Error('Expected the exact Muya Prism language glob in loadLanguage.ts')
      }

      return {
        contents: source.replace(globCall, `({\n${prismLanguageModules}\n})`),
        loader: 'ts',
        resolveDir: dirname(path)
      }
    })
    build.onLoad({ filter: /[\\/]utils[\\/]diagram[\\/]plantuml[\\/]index\.ts$/ }, async ({ path }) => {
      const expectedPath = resolve(__dirname, 'vendor/muya/src/utils/diagram/plantuml/index.ts')
      if (resolve(path) !== expectedPath) return undefined

      return {
        contents: [
          'if (globalThis.__tracePlantumlRendererGate) {',
          '  globalThis.__tracePlantumlRendererStarted?.()',
          '  await globalThis.__tracePlantumlRendererGate',
          '}',
          await readFile(path, 'utf8'),
          'globalThis.__tracePlantumlRendererCompleted?.()'
        ].join('\n'),
        loader: 'ts'
      }
    })
  }
}

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    include: ['test/**/*.spec.ts', 'test/**/*.spec.tsx'],
    environment: 'node',
    deps: {
      optimizer: {
        client: {
          enabled: true,
          force: true,
          include: ['@muyajs/core', '@muyajs/core/utils/diagram/index.js'],
          esbuildOptions: {
            plugins: [muyaRendererIntegrationPlugin]
          }
        }
      }
    }
  }
})

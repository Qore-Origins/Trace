import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const rendererOutput = resolve('out/renderer')
const assetsOutput = resolve(rendererOutput, 'assets')

beforeAll(
  () => {
    const npmCli = process.env.npm_execpath
    if (!npmCli) throw new Error('npm_execpath is required to run the bundle budget build')
    execFileSync(process.execPath, [npmCli, 'run', 'build'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe'
    })
  },
  120_000
)

describe('renderer bundle budget', () => {
  it('keeps the initial entry below 700 KiB and emits page/vendor chunks', () => {
    const html = readFileSync(resolve(rendererOutput, 'index.html'), 'utf8')
    const entryMatch = html.match(/<script[^>]+src="\.\/assets\/(index-[^"]+\.js)"/)
    expect(entryMatch, 'renderer index.html must reference a hashed entry script').not.toBeNull()

    const entryFile = entryMatch?.[1] ?? ''
    const javascriptFiles = readdirSync(assetsOutput).filter((file) => file.endsWith('.js'))

    expect(statSync(resolve(assetsOutput, entryFile)).size).toBeLessThan(700 * 1024)
    expect(javascriptFiles.length).toBeGreaterThan(4)
    expect(javascriptFiles.some((file) => file.startsWith('DiaryView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('MemoriesView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-react-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-antd-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-dnd-'))).toBe(true)
  })

  it('keeps Muya and diagram engines behind dynamic import boundaries', () => {
    const electronViteConfig = readFileSync(resolve('electron.vite.config.ts'), 'utf8')
    const app = readFileSync(resolve('src/renderer/src/App.tsx'), 'utf8')
    const runtime = readFileSync(resolve('src/renderer/src/components/muya-note/muya-runtime.ts'), 'utf8')
    const diagrams = readFileSync(resolve('vendor/muya/src/utils/diagram/index.ts'), 'utf8')
    const plantuml = readFileSync(resolve('vendor/muya/src/utils/diagram/plantuml/index.ts'), 'utf8')

    expect(app).not.toContain("from '@muyajs/core'")
    expect(electronViteConfig).toMatch(/optimizeDeps:\s*\{[\s\S]*?include:\s*\[[^\]]*'@muyajs\/core'/)
    expect(runtime).toContain("import('@muyajs/core')")
    expect(runtime).not.toMatch(/^import\s+\{[\s\S]*?\}\s+from\s+'@muyajs\/core'/m)
    for (const dependency of ['mermaid', 'vega-embed']) {
      expect(diagrams).toContain(`import('${dependency}')`)
    }
    expect(diagrams).toContain("import('./plantuml')")
    expect(plantuml).toContain("from 'plantuml-encoder'")
  })

  it('does not mix dynamic and static imports for always-present stores', () => {
    const appStore = readFileSync(resolve('src/renderer/src/stores/app-store.ts'), 'utf8')
    const topBar = readFileSync(resolve('src/renderer/src/components/TopBar.tsx'), 'utf8')

    expect(appStore).not.toContain("import('./tree-store')")
    expect(appStore).not.toContain("import('./plan-store')")
    expect(topBar).not.toContain("import('../stores/ui-store')")
  })
})

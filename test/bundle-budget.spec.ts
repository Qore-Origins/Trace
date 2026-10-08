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
  it('does not patch stdout at config import or for dev/TTY, and only fills missing build cursor methods', async () => {
    const stdoutBeforeImport = {
      clearLine: process.stdout.clearLine,
      cursorTo: process.stdout.cursorTo,
      moveCursor: process.stdout.moveCursor
    }
    const configModule = await import('../electron.vite.config')
    const configFactory = configModule.default as (environment: { command: string; mode: string }) => unknown
    configFactory({ command: 'serve', mode: 'development' })
    expect({
      clearLine: process.stdout.clearLine,
      cursorTo: process.stdout.cursorTo,
      moveCursor: process.stdout.moveCursor
    }).toEqual(stdoutBeforeImport)

    const configure = configModule.configureReporterStdout
    const pipe = { isTTY: false } as NodeJS.WriteStream
    configure('serve', pipe)
    expect(pipe.clearLine).toBeUndefined()
    expect(pipe.cursorTo).toBeUndefined()
    expect(pipe.moveCursor).toBeUndefined()
    configure('build', pipe)
    expect(typeof pipe.clearLine).toBe('function')
    expect(typeof pipe.cursorTo).toBe('function')
    expect(typeof pipe.moveCursor).toBe('function')

    const ttyMethods = {
      clearLine: () => true,
      cursorTo: () => true,
      moveCursor: () => true
    }
    const tty = { isTTY: true, ...ttyMethods } as NodeJS.WriteStream
    configure('build', tty)
    expect(tty.clearLine).toBe(ttyMethods.clearLine)
    expect(tty.cursorTo).toBe(ttyMethods.cursorTo)
    expect(tty.moveCursor).toBe(ttyMethods.moveCursor)
  })

  it('keeps the initial entry below 700 KiB and emits page/vendor chunks', () => {
    const html = readFileSync(resolve(rendererOutput, 'index.html'), 'utf8')
    const entryMatch = html.match(/<script[^>]+src="\.\/assets\/(index-[^"]+\.js)"/)
    expect(entryMatch, 'renderer index.html must reference a hashed entry script').not.toBeNull()

    const entryFile = entryMatch?.[1] ?? ''
    const javascriptFiles = readdirSync(assetsOutput).filter((file) => file.endsWith('.js'))

    expect(statSync(resolve(assetsOutput, entryFile)).size).toBeLessThan(700 * 1024)
    expect(javascriptFiles.length).toBeGreaterThan(4)
    expect(javascriptFiles.some((file) => file.startsWith('WorkspaceView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('ExportView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('DiaryView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('MemoriesView-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-react-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-antd-'))).toBe(true)
    expect(javascriptFiles.some((file) => file.startsWith('vendor-dnd-'))).toBe(true)
  })

  it('loads emitted workspace/export routes dynamically while keeping the application shell in the entry', () => {
    const html = readFileSync(resolve(rendererOutput, 'index.html'), 'utf8')
    const entryFile = html.match(/<script[^>]+src="\.\/assets\/(index-[^"]+\.js)"/)?.[1]
    expect(entryFile).toBeDefined()
    const entry = readFileSync(resolve(assetsOutput, entryFile ?? ''), 'utf8')
    const javascriptFiles = readdirSync(assetsOutput).filter((file) => file.endsWith('.js'))
    const initialGraph = new Set<string>()
    const pendingFiles = [entryFile ?? '']
    while (pendingFiles.length > 0) {
      const file = pendingFiles.pop() ?? ''
      if (initialGraph.has(file)) continue
      initialGraph.add(file)
      const chunk = readFileSync(resolve(assetsOutput, file), 'utf8')
      for (const dependency of chunk.matchAll(/^import\s+(?:[^;\n]*?\s+from\s+)?["']\.\/([^"']+\.js)["']/gm)) {
        pendingFiles.push(dependency[1])
      }
    }
    for (const route of ['WorkspaceView', 'ExportView']) {
      const routeFile = javascriptFiles.find((file) => file.startsWith(`${route}-`))
      expect(routeFile, `${route} must have an emitted chunk`).toBeDefined()
      const routeChunk = readFileSync(resolve(assetsOutput, routeFile ?? ''), 'utf8')
      const escapedRoutePath = `./${routeFile}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      expect(entry).toMatch(new RegExp(`import\\(["']${escapedRoutePath}["']\\)`))
      expect(entry).not.toMatch(new RegExp(`(?:from\\s*|^import\\s*)["']${escapedRoutePath}["']`, 'm'))
      expect(html).not.toMatch(new RegExp(`<link[^>]+rel="modulepreload"[^>]+href="[^"]*${route}-`))
      expect(routeChunk).toContain(`function ${route}(`)
      expect(entry).not.toContain(`function ${route}(`)
      expect(initialGraph.has(routeFile ?? ''), `${route} must stay outside the initial static import graph`).toBe(false)
    }
    const cardsFile = javascriptFiles.find((file) => file.startsWith('cards-'))
    expect(cardsFile, 'workspace and export must share an emitted cards chunk').toBeDefined()
    expect(readFileSync(resolve(assetsOutput, cardsFile ?? ''), 'utf8')).toContain('function ComponentRenderer(')
    expect(initialGraph.has(cardsFile ?? ''), 'card rendering must stay outside the initial static import graph').toBe(false)
    const workspaceFile = javascriptFiles.find((file) => file.startsWith('WorkspaceView-')) ?? ''
    const workspace = readFileSync(resolve(assetsOutput, workspaceFile), 'utf8')
    for (const component of ['PlanTreePanel', 'ContentArea']) {
      expect(workspace).toContain(`function ${component}(`)
      expect(entry).not.toContain(`function ${component}(`)
    }
    for (const component of ['AppShell', 'TopBar', 'StatusBar', 'OnboardingView']) {
      expect(entry).toContain(`function ${component}(`)
    }
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

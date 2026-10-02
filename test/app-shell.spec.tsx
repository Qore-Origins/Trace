import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppShell from '../src/renderer/src/components/AppShell'

const rendererRoot = resolve('src/renderer/src')
const shellPath = resolve(rendererRoot, 'components/AppShell.tsx')
const overlaysOutsideActiveView = new RegExp([
  '<AppShell[\\s\\S]*?<Suspense[\\s\\S]*?',
  '<DiaryView key=\\{rootDir[\\s\\S]*?<MemoriesView key=\\{rootDir[\\s\\S]*?',
  '<WorkspaceView \\/>[\\s\\S]*?<\\/Suspense>[\\s\\S]*?<\\/AppShell>',
  '\\s*<NameDialogModal \\/>\\s*<SearchOverlay \\/>\\s*<UndoNotice \\/>',
  '\\s*<TopBarSettingsHost \\/>'
].join(''))

describe('AppShell frame', () => {
  it('owns exactly one top bar and hides the status bar by default', () => {
    expect(existsSync(shellPath), 'AppShell must be the shared ready-state frame').toBe(true)
    const activeView = createElement('section', { id: 'active-view' }, 'active')
    const html = renderToStaticMarkup(createElement(AppShell, null, activeView))

    expect(html.match(/class="ws-top"/g)).toHaveLength(1)
    expect(html).not.toContain('class="ws-status"')
    expect(html).toContain('id="active-view"')
  })

  it('renders the workspace status bar only when requested', () => {
    expect(existsSync(shellPath), 'AppShell must expose showStatus').toBe(true)
    const options = { showStatus: true, className: 'app-shell--workspace' }
    const html = renderToStaticMarkup(createElement(AppShell, options, 'workspace'))

    expect(html.match(/class="ws-top"/g)).toHaveLength(1)
    expect(html.match(/class="ws-status"/g)).toHaveLength(1)
    expect(html).toContain('app-shell--workspace')
  })
})

describe('App composition', () => {
  it('keeps global overlays outside the keyed active view', () => {
    const app = readFileSync(resolve(rendererRoot, 'App.tsx'), 'utf8')
    expect(app).toContain("import AppShell from './components/AppShell'")
    expect(app).toMatch(overlaysOutsideActiveView)
    expect(app).toContain("showStatus={view === 'workspace'}")
  })

  it('lazy-loads secondary views while keeping the workspace in the initial graph', () => {
    const app = readFileSync(resolve(rendererRoot, 'App.tsx'), 'utf8')

    expect(app).toContain("const DiaryView = lazy(() => import('./views/DiaryView'))")
    expect(app).toContain("const MemoriesView = lazy(() => import('./views/MemoriesView'))")
    expect(app).toContain("import WorkspaceView from './views/WorkspaceView'")
    expect(app).not.toContain("import DiaryView from './views/DiaryView'")
    expect(app).not.toContain("import MemoriesView from './views/MemoriesView'")
    expect(app).toContain("background: 'var(--paper)'")
    expect(app).toContain("color: 'var(--text-2)'")
  })

  it('leaves each ready view as content without its own app chrome', () => {
    for (const relativePath of ['views/WorkspaceView.tsx', 'views/DiaryView.tsx', 'views/MemoriesView.tsx']) {
      const source = readFileSync(resolve(rendererRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toContain("import TopBar from '../components/TopBar'")
      expect(source, relativePath).not.toContain('<TopBar />')
      expect(source, relativePath).not.toContain('<StatusBar />')
    }
  })
})

describe('Responsive shell layout', () => {
  it('stacks diary and memories secondary content below 960px', () => {
    const diary = readFileSync(resolve(rendererRoot, 'styles/diary.css'), 'utf8')
    const memories = readFileSync(resolve(rendererRoot, 'styles/memories.css'), 'utf8')
    expect(diary).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.diary-layout\s*\{[^}]*flex-direction:\s*column/)
    expect(diary).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.diary-tl\s*\{[^}]*width:\s*100%/)
    expect(memories).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.memories-body\s*\{[^}]*flex-direction:\s*column/)
    expect(memories).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.memories-preview\s*\{[^}]*width:\s*auto/)
  })

  it('keeps compact top-bar labels on one line at narrow widths', () => {
    const css = readFileSync(resolve(rendererRoot, 'styles/shell.css'), 'utf8')
    expect(css).toMatch(/\.app-shell \.brand,[\s\S]*?white-space:\s*nowrap/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.ws-top\s*\{[^}]*gap:\s*6px/)
    expect(css).toMatch(/\.ws-top \.search\s*\{[^}]*min-width:\s*0/)
  })

  it('places the page capsule on the window midpoint with shrinkable search and compact menus', () => {
    const topBar = readFileSync(resolve(rendererRoot, 'components/TopBar.tsx'), 'utf8')
    const css = readFileSync(resolve(rendererRoot, 'styles/shell.css'), 'utf8')
    expect(topBar).toMatch(/className="top-left"[\s\S]*?<MenuBar \/>/)
    expect(topBar).toMatch(/className="top-center"[\s\S]*?<ViewNav \/>/)
    expect(topBar).toMatch(
      /className="top-right"[\s\S]*?className="search"[\s\S]*?<WindowControls \/>/
    )
    expect(css).toMatch(/\.ws-top\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 294px minmax\(0, 1fr\);/)
    expect(css).toMatch(/\.ws-top \.search\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 0;/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.menubar\s*\{[^}]*gap:\s*0;/)
  })
})

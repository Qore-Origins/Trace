import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AppShell from '../src/renderer/src/components/AppShell'

const rendererRoot = resolve('src/renderer/src')
const shellPath = resolve(rendererRoot, 'components/AppShell.tsx')

describe('AppShell structure contract', () => {
  it('owns exactly one top bar and hides the status bar by default', () => {
    expect(existsSync(shellPath), 'AppShell must be the shared ready-state frame').toBe(true)
    const html = renderToStaticMarkup(createElement(AppShell, null, createElement('section', { id: 'active-view' }, 'active')))

    expect(html.match(/class="ws-top"/g)).toHaveLength(1)
    expect(html).not.toContain('class="ws-status"')
    expect(html).toContain('id="active-view"')
  })

  it('renders the workspace status bar only when requested', () => {
    expect(existsSync(shellPath), 'AppShell must expose showStatus').toBe(true)
    const html = renderToStaticMarkup(createElement(AppShell, { showStatus: true, className: 'app-shell--workspace' }, 'workspace'))

    expect(html.match(/class="ws-top"/g)).toHaveLength(1)
    expect(html.match(/class="ws-status"/g)).toHaveLength(1)
    expect(html).toContain('app-shell--workspace')
  })

  it('keeps global overlays outside the keyed active view', () => {
    const app = readFileSync(resolve(rendererRoot, 'App.tsx'), 'utf8')
    expect(app).toContain("import AppShell from './components/AppShell'")
    expect(app).toMatch(/<AppShell[\s\S]*?<DiaryView key=\{rootDir[\s\S]*?<MemoriesView key=\{rootDir[\s\S]*?<WorkspaceView \/>[\s\S]*?<\/AppShell>\s*<NameDialogModal \/>\s*<SearchOverlay \/>\s*<UndoNotice \/>\s*<TopBarSettingsHost \/>/)
    expect(app).toContain("showStatus={view === 'workspace'}")
  })

  it('leaves each ready view as content without its own app chrome', () => {
    for (const relativePath of ['views/WorkspaceView.tsx', 'views/DiaryView.tsx', 'views/MemoriesView.tsx']) {
      const source = readFileSync(resolve(rendererRoot, relativePath), 'utf8')
      expect(source, relativePath).not.toContain("import TopBar from '../components/TopBar'")
      expect(source, relativePath).not.toContain('<TopBar />')
      expect(source, relativePath).not.toContain('<StatusBar />')
    }
  })

  it('stacks diary and memories secondary content below 960px', () => {
    const shellCssPath = resolve(rendererRoot, 'styles/shell.css')
    expect(existsSync(shellCssPath), 'shell.css must own the responsive ready-state frame').toBe(true)
    if (!existsSync(shellCssPath)) return

    const css = readFileSync(shellCssPath, 'utf8')
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.diary-layout\s*\{[^}]*flex-direction:\s*column/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.diary-tl\s*\{[^}]*width:\s*100%/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.memories-body\s*\{[^}]*flex-direction:\s*column/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.memories-preview\s*\{[^}]*width:\s*auto/)
  })

  it('keeps compact top-bar labels on one line at narrow widths', () => {
    const css = readFileSync(resolve(rendererRoot, 'styles/shell.css'), 'utf8')
    expect(css).toMatch(/\.app-shell \.brand,[\s\S]*?white-space:\s*nowrap/)
    expect(css).toMatch(/@media\s*\(max-width:\s*959px\)[\s\S]*?\.ws-top\s*\{[^}]*gap:\s*6px/)
    expect(css).toMatch(/\.ws-top \.search\s*\{[^}]*min-width:\s*0/)
  })
})

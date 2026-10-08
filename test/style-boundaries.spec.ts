import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesRoot = resolve(process.cwd(), 'src/renderer/src/styles')
const rendererRoot = resolve(process.cwd(), 'src/renderer/src')

describe('renderer style boundaries', () => {
  it('keeps workspace.css as the ordered compatibility entry only', () => {
    const expectedImports = [
      'tokens.css',
      'base.css',
      'actions.css',
      'shell.css',
      'tree.css',
      'cards.css',
      'search.css',
      'diary.css',
      'memories.css',
      'plan-name-templates.css',
      'agent-settings.css',
      'agent-view.css',
      'plan-tabs.css',
      'plan-reference.css',
      'trash.css'
    ]

    for (const file of expectedImports) {
      expect(existsSync(resolve(stylesRoot, file)), `${file} should exist`).toBe(true)
    }

    const workspace = readFileSync(resolve(stylesRoot, 'workspace.css'), 'utf8')
    const imports = [...workspace.matchAll(/@import\s+["']\.\/(.+?)["'];/g)].map((match) => match[1])

    expect(imports).toEqual(expectedImports)
    expect(workspace.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '').trim()).toBe('')
  })
})

describe('renderer selector ownership', () => {
  it('places representative selectors in their owned domains', () => {
    const selectorsByFile: Record<string, string[]> = {
      'shell.css': ['.ws-top', '.ws-main', '.ws-status', '.onboard'],
      'tree.css': ['.ws-tree', '.tree-row', '.slot', '.tree-trash-entry'],
      'cards.css': ['.export-root', '.ws-content', '.card', '.note-md', '.folder-grid'],
      'search.css': ['.search-mask', '.search-overlay'],
      'diary.css': ['.diary-main', '.diary-layout', '@media (max-width: 959px)'],
      'memories.css': ['.memories-body', '.memories-preview', '@media (max-width: 959px)'],
      'plan-name-templates.css': ['.plan-name-template-settings', '.name-dialog-template__preview'],
      'agent-settings.css': ['.agent-settings', '.agent-settings-actions', '.agent-settings-hint'],
      'agent-view.css': ['.agent-view', '.agent-context-picker', '.agent-preview'],
      'plan-tabs.css': ['.plan-tabs', '.plan-tabs__item', '.plan-tabs__select', '.plan-tabs__close'],
      'trash.css': ['.trash-entries', '.trash-entry', '.trash-restore-form', '.trash-purge-confirmation']
    }

    for (const [file, selectors] of Object.entries(selectorsByFile)) {
      const css = readFileSync(resolve(stylesRoot, file), 'utf8')
      for (const selector of selectors) expect(css, `${selector} should be owned by ${file}`).toContain(selector)
      if (file !== 'plan-name-templates.css') {
        expect(css).not.toContain('.plan-name-template-settings')
        expect(css).not.toContain('.name-dialog-template__')
      }
    }
  })

  it('loads action styles only through the workspace entry', () => {
    const actionButton = readFileSync(resolve(rendererRoot, 'components/ui/ActionButton.tsx'), 'utf8')
    expect(actionButton).not.toContain("import '../../styles/actions.css'")
  })

  it('keeps plan tabs scrollable at narrow widths, theme-token based, and reduced-motion safe', () => {
    const planTabs = readFileSync(resolve(stylesRoot, 'plan-tabs.css'), 'utf8')

    expect(planTabs).toMatch(/\.plan-tabs\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;/s)
    expect(planTabs).toContain('@media (max-width: 720px)')
    expect(planTabs).toContain('@media (prefers-reduced-motion: reduce)')
    expect(planTabs).toContain('transition: none;')
    expect(planTabs).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i)
  })
})

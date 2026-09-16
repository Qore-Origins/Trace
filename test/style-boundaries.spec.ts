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
      'memories.css'
    ]

    for (const file of expectedImports) {
      expect(existsSync(resolve(stylesRoot, file)), `${file} should exist`).toBe(true)
    }

    const workspace = readFileSync(resolve(stylesRoot, 'workspace.css'), 'utf8')
    const imports = [...workspace.matchAll(/@import\s+["']\.\/(.+?)["'];/g)].map((match) => match[1])

    expect(imports).toEqual(expectedImports)
    expect(workspace.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]+;/g, '').trim()).toBe('')
  })

  it('places representative selectors in their owned domains', () => {
    const selectorsByFile: Record<string, string[]> = {
      'shell.css': ['.ws-top', '.ws-main', '.ws-status', '.onboard'],
      'tree.css': ['.ws-tree', '.tree-row', '.slot'],
      'cards.css': ['.export-root', '.ws-content', '.card', '.note-md', '.folder-grid'],
      'search.css': ['.search-mask', '.search-overlay'],
      'diary.css': ['.diary-main', '.diary-layout', '@media (max-width: 959px)'],
      'memories.css': ['.memories-body', '.memories-preview', '@media (max-width: 959px)']
    }

    for (const [file, selectors] of Object.entries(selectorsByFile)) {
      const css = readFileSync(resolve(stylesRoot, file), 'utf8')
      for (const selector of selectors) expect(css, `${selector} should be owned by ${file}`).toContain(selector)
    }
  })

  it('loads action styles only through the workspace entry', () => {
    const actionButton = readFileSync(resolve(rendererRoot, 'components/ui/ActionButton.tsx'), 'utf8')
    expect(actionButton).not.toContain("import '../../styles/actions.css'")
  })
})

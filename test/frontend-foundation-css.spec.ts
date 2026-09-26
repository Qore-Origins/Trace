import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve('src/renderer/src')
const workspace = readFileSync(resolve(root, 'styles/workspace.css'), 'utf8')
const css = ['shell.css', 'tree.css', 'cards.css', 'search.css', 'diary.css', 'memories.css']
  .map((file) => readFileSync(resolve(root, 'styles', file), 'utf8'))
  .join('\n')
const tokensPath = resolve(root, 'styles/tokens.css')
const basePath = resolve(root, 'styles/base.css')
const tokens = existsSync(tokensPath) ? readFileSync(tokensPath, 'utf8') : workspace
const base = existsSync(basePath) ? readFileSync(basePath, 'utf8') : css
function luminance(hex: string): number {
  const channels = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
describe('frontend information and interaction foundation', () => {
  it('keeps ordinary information text readable on all theme surfaces', () => {
    const blocks = [...tokens.matchAll(/(?:\:root|html\.theme-dark)\s*\{([^}]+)\}/g)]
    expect(blocks).toHaveLength(2)
    let values: Record<string, string> = {}
    for (const block of blocks) {
      values = { ...values, ...Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map((m) => [m[1], m[2]])) }
      for (const text of ['text-1', 'text-2', 'text-3', 'link']) for (const surface of ['paper', 'paper-dim', 'fill', 'trace-bg']) {
        const light = luminance(values[text]), background = luminance(values[surface])
        expect((Math.max(light, background) + .05) / (Math.min(light, background) + .05), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
      for (const [text, surface] of [['warn-text', 'warn-bg'], ['danger-text', 'paper'], ['on-primary', 'trace-700'], ['on-primary', 'origin']]) {
        const light = luminance(values[text]), background = luminance(values[surface])
        expect((Math.max(light, background) + .05) / (Math.min(light, background) + .05), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
  it('keeps tokens and global rules behind the compatible workspace entry', () => {
    expect(workspace).toContain('@import "./tokens.css"')
    expect(workspace).toContain('@import "./base.css"')
    expect(workspace).not.toMatch(/--[\w-]+:\s*#/)
    expect(base).toContain('::view-transition-old(root)')
  })
  it('reserves muted decoration for non-information elements', () => {
    for (const selector of ['.mem-date', '.mem-empty', '.mem-pv-empty', '.card .kind', '.note-time', '.mood-meta', '.o-section', '.diary-comps', '.diary-cal-foot']) {
      expect(css.indexOf(selector), selector).toBeGreaterThanOrEqual(0)
      const rule = css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)))
      expect(rule, selector).not.toContain('var(--text-4)')
    }
  })
  it('makes outline-free editors visibly focusable', () => {
    for (const selector of ['.single-title:focus-visible', '.task-title input:focus-visible', '.o-input:focus-visible']) expect(base).toContain(selector)
    expect(base).toContain('.mem-card:focus-visible')
  })
  it('styles the in-progress task ring and title from the rendered row class', () => {
    expect(css).toContain('.task-row.in_progress .state-ring')
    expect(css).toContain('.task-row.in_progress .task-title input')
    expect(css).not.toContain('.task-row.doing')
  })
  it('reduces all ordinary motion while preserving the normal tree height transition', () => {
    expect(css).not.toMatch(/transition:\s*all\b/)
    expect(css).toContain('transition: grid-template-rows var(--t-slot)')
    expect(base).toMatch(/prefers-reduced-motion:[\s\S]*transition-duration:\s*0s\s*!important/)
    expect(base).toMatch(/animation-duration:\s*0s\s*!important/)
  })
  it('announces asynchronous status politely', () => {
    expect(readFileSync(resolve(root, 'components/StatusBar.tsx'), 'utf8')).toContain('aria-live="polite"')
  })
  it('reveals keyboard focused tree quick actions at their original vertical position', () => {
    expect(css).toContain('.tree-row:focus-within .tree-quick')
    const rule = css.slice(css.indexOf('.tree-row:focus-within .tree-quick'), css.indexOf('}', css.indexOf('.tree-row:focus-within .tree-quick')))
    expect(rule).toContain('opacity: 1')
    expect(rule).toContain('translateY(-50%) translateX(0)')
  })
  it('uses native keyboard activation for menus and explicit activation for search results', () => {
    expect(readFileSync(resolve(root, 'components/TopBar.tsx'), 'utf8')).toContain('<button type="button" className="menu-title"')
    const search = readFileSync(resolve(root, 'components/SearchOverlay.tsx'), 'utf8')
    expect(search).toMatch(/<button[\s\S]*?className="o-item"/)
    expect(search).toContain('SEARCH_PAGE_SIZE')
  })
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Muya note editor demo', () => {
  it('启动真实 Muya 内核且不存在模拟渲染路径', async () => {
    const main = await readFile('demo/muya-note-editor/main.ts', 'utf8')
    const prismLoader = await readFile('vendor/muya/src/utils/prism/loadLanguage.ts', 'utf8')
    const viteConfig = await readFile('demo/muya-note-editor/vite.config.ts', 'utf8')

    expect(main).toContain("from '@muyajs/core'")
    expect(main).toContain('new Muya(')
    expect(main).toContain('registerMuyaPlugins()')
    expect(main).not.toMatch(/innerHTML\s*=.*replace/)
    expect(prismLoader).toContain('import.meta.glob(')
    expect(prismLoader).not.toContain('`../../../node_modules/prismjs')
    expect(viteConfig).toContain('experimentalDecorators: true')
  })

  it('只提供实时渲染开关并包含完整图表样例', async () => {
    const html = await readFile('demo/muya-note-editor/index.html', 'utf8')
    const main = await readFile('demo/muya-note-editor/main.ts', 'utf8')
    const style = await readFile('demo/muya-note-editor/style.css', 'utf8')

    expect(html).toContain('实时渲染')
    expect(html).not.toContain('自动渲染')
    expect(main).toContain('```mermaid')
    expect(main).toContain('```vega-lite')
    expect(main).toContain('```plantuml')
    expect(main).toContain('```flowchart')
    expect(main).toContain('```sequence')
    expect(style).toContain('transition-delay: 2s')
  })
})

// NoteMarkdown 解析器单测（renderer 纯函数；React 节点仅断言类型/标签，不渲染）
import { describe, expect, it } from 'vitest'
import { highlightCode, parseBlocks, renderText } from '../src/renderer/src/components/note-md'

describe('note-md parseBlocks', () => {
  it('代码块：闭合围栏转为 code 块，内容原样', () => {
    const blocks = parseBlocks('```python\ndef main():\n    print(1)\n```')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('code')
    expect((blocks[0] as { code: string }).code).toBe('def main():\n    print(1)')
    expect((blocks[0] as { lang: string }).lang).toBe('python')
  })

  it('代码块：未闭合围栏吞到文末', () => {
    const blocks = parseBlocks('```\na\nb\n')
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { code: string }).code).toBe('a\nb')
  })

  it('代码块不残留围栏文本（迁移保底注释核心场景）', () => {
    const text = parseBlocks('```python\ndef main():\n    pass\n```').map((b) => (b.kind === 'code' ? b.code : '')).join('')
    expect(text).not.toContain('```')
  })

  it('段落：空行分隔，行内空格保留', () => {
    const blocks = parseBlocks('**粗体** 你好\n第二行\n\n第三段')
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'para'])
  })

  it('无序/有序列表聚合', () => {
    const ul = parseBlocks('- 甲\n- 乙\n- 丙')
    expect(ul).toHaveLength(1)
    expect((ul[0] as { kind: string; items: string[] }).kind).toBe('list')
    expect((ul[0] as { items: string[] }).items).toEqual(['甲', '乙', '丙'])

    const ol = parseBlocks('1. 一\n2. 二')
    expect((ol[0] as { ordered: boolean }).ordered).toBe(true)
  })

  // 2026-09-10 渲染错误修复（用户截图：HTML 注释字面泄漏+引用/分隔线/表格平铺）
  it('HTML 注释剥除：单行与跨行均不显示，前后文本保留', () => {
    const blocks = parseBlocks('前段<!-- 隐藏\n- 甲\n- 乙 -->后段')
    // 跨行注释剥离后残留换行 → 前后文各成一段（注释内容不出现）
    expect(blocks.map((b) => (b as { lines: string[] }).lines.join(''))).toEqual(['前段', '后段'])
  })

  it('HTML 注释剥除：行内单行注释前后文合成一段', () => {
    const blocks = parseBlocks('甲<!-- 隐藏 -->乙')
    expect(blocks).toHaveLength(1)
    expect((blocks[0] as { lines: string[] }).lines.join('')).toBe('甲乙')
  })

  it('HTML 注释在代码块内原样保留', () => {
    const blocks = parseBlocks('```\n<!-- x -->\n```')
    expect(blocks[0].kind).toBe('code')
    expect((blocks[0] as { code: string }).code).toBe('<!-- x -->')
  })

  it('引用块聚合（> 前缀剥离）', () => {
    const blocks = parseBlocks('> 命名释义\n> 口号详见文档')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('quote')
    expect((blocks[0] as { lines: string[] }).lines).toEqual(['命名释义', '口号详见文档'])
  })

  it('分隔线渲染为 hr 块', () => {
    expect(parseBlocks('a\n\n---\n\nb').map((b) => b.kind)).toEqual(['para', 'hr', 'para'])
  })

  it('表格：表头+分隔行+数据行', () => {
    const blocks = parseBlocks('| 项 | 值 |\n|---|---|\n| 中文名 | 溯源 |\n| 包名 | com.qore.trace |')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].kind).toBe('table')
    const t = blocks[0] as { head: string[]; rows: string[][] }
    expect(t.head).toEqual(['项', '值'])
    expect(t.rows).toEqual([
      ['中文名', '溯源'],
      ['包名', 'com.qore.trace']
    ])
  })

  it('表格无分隔行时按段落处理（不误判）', () => {
    const blocks = parseBlocks('| 只有一行 | 没有分隔 |')
    expect(blocks[0].kind).toBe('para')
  })
})

describe('note-md highlightCode（2026-09-10 代码块语法高亮）', () => {
  it('已知语言：产出 hljs 着色 span，原文转义保留', () => {
    const html = highlightCode('const n = 1 // 注释', 'javascript')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('hljs-comment')
    expect(html).toContain('const')
  })

  it('HTML 内容被转义（无注入面）', () => {
    const html = highlightCode('<script>alert(1)</script>', 'javascript')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('未知语言回退纯转义（原文可还原）', () => {
    const html = highlightCode('a < b & c', 'not-a-lang')
    expect(html).toBe('a &lt; b &amp; c')
  })

  it('未声明语言同样回退纯转义', () => {
    expect(highlightCode('x > 1', '')).toBe('x &gt; 1')
  })
})

describe('note-md renderText（React 片段结构）', () => {
  it('粗体/行内码', () => {
    const nodes = renderText('这是**很重**与`c1 := 2`代码', 'k')
    expect(nodes.map((n) => (typeof n === 'object' ? (n as { type: unknown }).type : '»»' + n))).toEqual([
      '»»这是',
      'strong',
      '»»与',
      'code',
      '»»代码'
    ])
  })

  it('链接文本与目标保留', () => {
    const nodes = renderText('看[这里](https://a.b/c)', 'k')
    const a = nodes.find((n) => typeof n === 'object' && (n as { type: unknown }).type === 'a') as { props: { href: string; children: string } }
    expect(a.props.href).toBe('https://a.b/c')
    expect(a.props.children).toBe('这里')
  })

  it('普通文本原样、无 React 实体', () => {
    expect(renderText('a <b> & c', 'k').join('')).toBe('a <b> & c')
  })
})

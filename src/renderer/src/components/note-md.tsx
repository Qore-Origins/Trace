// NoteMarkdown：注释组件的最小 Markdown 渲染器（零依赖，覆盖注释实际出现的子集）
// 语料来源：Markdown 迁入保底注释（transfer-service 定典）——代码块/粗体/行内码/链接/列表/小标题
// 安全：纯 React 节点输出（无 dangerouslySetInnerHTML / innerHTML），链接默认拦截不导航
import { useMemo } from 'react'
import type { ReactNode } from 'react'

// ---------- 块级解析 ----------

type Block =
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string; code: string }

interface FenceMatch {
  lang: string
}

function isFence(line: string): FenceMatch | null {
  const m = /^```([\w+-]*)\s*$/.exec(line)
  return m ? { lang: m[1] } : null
}

function isFenceEnd(line: string): boolean {
  return /^```\s*$/.test(line)
}

export function parseBlocks(text: string): Block[] {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // 1. 代码块（```lang ... ```，未闭合则到文末）
    const fence = isFence(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !isFenceEnd(lines[i])) {
        code.push(lines[i])
        i++
      }
      i++ // 跳过结束围栏（未闭合时 i===length 自然结束）
      while (code.length > 0 && code[code.length - 1] === '') code.pop() // 文末换行遗留的空行不进代码体
      blocks.push({ kind: 'code', lang: fence.lang, code: code.join('\n') })
      continue
    }

    // 2. 空行分隔
    if (line.trim() === '') {
      i++
      continue
    }

    // 3. 列表（- / * / 1. 平铺，连续匹配行聚合为一个块）
    const ul = /^\s*[-*]\s+(.+)$/.exec(line)
    const ol = /^\s*\d+\.\s+(.+)$/.exec(line)
    if (ul || ol) {
      const ordered = ul === null
      const items: string[] = []
      while (i < lines.length) {
        const m = ordered ? /^\s*\d+\.\s+(.+)$/.exec(lines[i]) : /^\s*[-*]\s+(.+)$/.exec(lines[i])
        if (!m) break
        items.push(m[1])
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // 4. 段落：聚合到空行或下一个结构行为止
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isFence(lines[i]) && !/^\s*[-*]\s+\S/.test(lines[i]) && !/^\s*\d+\.\s+\S/.test(lines[i])) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'para', lines: para })
  }
  return blocks
}

// ---------- 行内解析 ----------

const INLINE_SPLIT = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/

export function renderText(text: string, keyBase: string, onLink?: (url: string) => void): ReactNode[] {
  const out: ReactNode[] = []
  const parts = text.split(INLINE_SPLIT)
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    const key = `${keyBase}-${i}`
    if (part === '') continue
    const code = /^`([^`]+)`$/.exec(part)
    if (code) {
      out.push(<code key={key}>{code[1]}</code>)
      continue
    }
    const bold = /^\*\*([^*]+)\*\*$/.exec(part)
    if (bold) {
      out.push(<strong key={key}>{bold[1]}</strong>)
      continue
    }
    const italic = /^\*([^*]+)\*$/.exec(part)
    if (italic) {
      out.push(<em key={key}>{italic[1]}</em>)
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      out.push(
        <a key={key} href={link[2]} onClick={(e) => { e.preventDefault(); onLink?.(link[2]) }}>
          {link[1]}
        </a>
      )
      continue
    }
    out.push(part)
  }
  return out
}

// ---------- 组件 ----------

export function NoteMarkdown({ content, onLink }: { content: string; onLink?: (url: string) => void }): React.JSX.Element {
  const blocks = useMemo(() => parseBlocks(content), [content])
  return (
    <div className="note-md">
      {blocks.map((b, bi) => {
        const key = `b-${bi}`
        if (b.kind === 'code') {
          return (
            <pre key={key} data-lang={b.lang}>
              <code>{b.code}</code>
            </pre>
          )
        }
        if (b.kind === 'list') {
          const items = b.items.map((it, li) => <li key={`${key}-i-${li}`}>{renderText(it, `${key}-i-${li}`, onLink)}</li>)
          return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
        }
        return <p key={key}>{renderText(b.lines.join(' '), key, onLink)}</p>
      })}
    </div>
  )
}

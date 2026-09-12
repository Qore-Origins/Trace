// NoteMarkdown：注释组件的 Markdown 渲染器（覆盖注释实际出现的子集）
// 语料来源：Markdown 迁入保底注释（transfer-service 定典）——代码块/粗体/行内码/链接/列表/小标题
// 2026-09-10 代码块语法高亮（用户计划项"markdown渲染高亮、代码块高亮"；marktext 同类功能用 prismjs，
//   本项目经选型用 highlight.js——lib/common 入口约 35 种常用语言）
// 安全：React 节点输出；唯二例外是代码块的 dangerouslySetInnerHTML——其内容经 highlight.js
//   转义（<>& 均转义后才插入着色 span）或 highlightCode 的手动转义，无注入面
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import hljs from 'highlight.js/lib/common'

// ---------- 块级解析 ----------

type Block =
  | { kind: 'para'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'code'; lang: string; code: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'hr' }
  | { kind: 'table'; head: string[]; rows: string[][] }

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

const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE_RE = /^\s*>\s?(.*)$/
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/

// HTML 注释剥除（<!-- ... -->，单行/跨行；代码块内原样保留）
// 2026-09-10 用户截图修复：命名设计文档内含注释，原实现把注释字面泄漏进正文
export function stripHtmlComments(text: string): string {
  const lines = text.split(/\r?\n/)
  const out: string[] = []
  let inFence = false
  let inComment = false
  for (const line of lines) {
    if (!inComment && isFence(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    let l = line
    for (;;) {
      if (inComment) {
        const end = l.indexOf('-->')
        if (end === -1) {
          l = ''
          break
        }
        inComment = false
        l = l.slice(end + 3)
        continue
      }
      const start = l.indexOf('<!--')
      if (start === -1) break
      const end = l.indexOf('-->', start + 4)
      if (end === -1) {
        inComment = true
        l = l.slice(0, start)
        break
      }
      l = l.slice(0, start) + l.slice(end + 3)
    }
    out.push(l)
  }
  return out.join('\n')
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

// 表格分隔行：仅由 空格 | : - 组成且含 -（如 |---|---| / |:--|--:|）
function isTableSep(line: string): boolean {
  const t = line.trim()
  return t.includes('-') && /^[\s|:-]+$/.test(t)
}

export function parseBlocks(text: string): Block[] {
  const lines = stripHtmlComments(text).split(/\r?\n/)
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

    // 2.5 分隔线
    if (HR_RE.test(line)) {
      blocks.push({ kind: 'hr' })
      i++
      continue
    }

    // 2.6 引用块（> 连续行聚合，前缀剥离）
    const q = QUOTE_RE.exec(line)
    if (q) {
      const qlines: string[] = []
      while (i < lines.length) {
        const m = QUOTE_RE.exec(lines[i])
        if (!m) break
        qlines.push(m[1])
        i++
      }
      blocks.push({ kind: 'quote', lines: qlines })
      continue
    }

    // 2.7 表格（| 行连续聚合；第二行为分隔行才成表，否则按段落）
    if (TABLE_ROW_RE.test(line)) {
      const rowsRaw: string[] = []
      while (i < lines.length && TABLE_ROW_RE.test(lines[i])) {
        rowsRaw.push(lines[i])
        i++
      }
      if (rowsRaw.length >= 2 && isTableSep(rowsRaw[1])) {
        blocks.push({ kind: 'table', head: tableCells(rowsRaw[0]), rows: rowsRaw.slice(2).map(tableCells) })
      } else {
        blocks.push({ kind: 'para', lines: rowsRaw })
      }
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

    // 4. 段落：聚合到空行或下一个结构行为止（含 hr/引用/表格起始）
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isFence(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !QUOTE_RE.test(lines[i]) &&
      !TABLE_ROW_RE.test(lines[i]) &&
      !/^\s*[-*]\s+\S/.test(lines[i]) &&
      !/^\s*\d+\.\s+\S/.test(lines[i])
    ) {
      para.push(lines[i])
      i++
    }
    blocks.push({ kind: 'para', lines: para })
  }
  return blocks
}

// ---------- 代码块高亮 ----------

const ESC_MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' }

// 代码块着色为 HTML 字符串（供 dangerouslySetInnerHTML）：
// 已知语言走 highlight.js（输出本身已转义）；未知/未声明语言退回纯转义（保持纯文本显示）
export function highlightCode(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      // 高亮器内部异常不阻塞渲染——退回纯文本
    }
  }
  return code.replace(/[&<>]/g, (c) => ESC_MAP[c])
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
              <code
                className={b.lang && hljs.getLanguage(b.lang) ? `hljs language-${b.lang}` : undefined}
                dangerouslySetInnerHTML={{ __html: highlightCode(b.code, b.lang) }}
              />
            </pre>
          )
        }
        if (b.kind === 'list') {
          const items = b.items.map((it, li) => <li key={`${key}-i-${li}`}>{renderText(it, `${key}-i-${li}`, onLink)}</li>)
          return b.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>
        }
        if (b.kind === 'hr') return <hr key={key} />
        if (b.kind === 'quote') {
          return <blockquote key={key}>{renderText(b.lines.join(' '), key, onLink)}</blockquote>
        }
        if (b.kind === 'table') {
          return (
            <table key={key}>
              <thead>
                <tr>
                  {b.head.map((c, ci) => (
                    <th key={`${key}-h-${ci}`}>{renderText(c, `${key}-h-${ci}`, onLink)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={`${key}-r-${ri}`}>
                    {r.map((c, ci) => (
                      <td key={`${key}-r-${ri}-${ci}`}>{renderText(c, `${key}-r-${ri}-${ci}`, onLink)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        return <p key={key}>{renderText(b.lines.join(' '), key, onLink)}</p>
      })}
    </div>
  )
}

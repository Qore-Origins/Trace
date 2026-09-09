// 共享校验规则（功能规格 §6.3 / LLD §7）
import { ERR, TraceError } from './errors'

// Windows 文件系统非法字符 + 保留名
const ILLEGAL_CHARS = /[/\\:*?"<>|]/
const RESERVED_NAMES = new Set(['.', '..', 'con', 'prn', 'aux', 'nul', 'com1', 'lpt1'])
const MAX_NAME_LEN = 255
const MAX_TEXT_LEN = 20000
const MAX_TITLE_LEN = 200

export function validatePlanName(name: string): void {
  if (!name || name.trim().length === 0) throw new TraceError(ERR.VALIDATION, '名称不能为空')
  if (name.length > MAX_NAME_LEN) throw new TraceError(ERR.VALIDATION, '名称超长（上限 255 字符）')
  if (ILLEGAL_CHARS.test(name)) throw new TraceError(ERR.VALIDATION, '名称含非法字符 / \\ : * ? " < > |')
  if (RESERVED_NAMES.has(name.toLowerCase())) throw new TraceError(ERR.VALIDATION, '名称为系统保留字')
  if (name.endsWith(' ') || name.endsWith('.')) throw new TraceError(ERR.VALIDATION, '名称不能以空格或点结尾')
}

export function validateTitle(title: string, field = '标题'): void {
  if (!title || title.trim().length === 0) throw new TraceError(ERR.VALIDATION, `${field}不能为空`)
  if (title.length > MAX_TITLE_LEN) throw new TraceError(ERR.VALIDATION, `${field}超长（上限 ${MAX_TITLE_LEN} 字符）`)
}

export function validateNoteText(text: string, field = '文本'): void {
  if (text.length > MAX_TEXT_LEN) throw new TraceError(ERR.VALIDATION, `${field}超长（上限 ${MAX_TEXT_LEN} 字符）`)
}

// 截止日期：'YYYY-MM-DD'；undefined/'' 表示清除；CLAMP 外一律抛 ERR.VALIDATION
export function validateDueDate(s: unknown): void {
  if (s === undefined || s === '') return // 清除，视为通过
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new TraceError(ERR.VALIDATION, '截止日期格式无效')
  }
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    throw new TraceError(ERR.VALIDATION, '截止日期无效（该日期不存在）')
  }
}

// 本地今天（'YYYY-MM-DD'，组件卡日期默认值/过期判断共用）
export function todayDateStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// uuid32（无连字符 32 hex）
export function isUuid32(s: string): boolean {
  return /^[0-9a-f]{32}$/.test(s)
}

export function uuid32(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// 心情评分：0-100 数字，可小数（收敛 ≤2 位）
export function validateScore(x: unknown): number {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : (x as number)
  if (typeof n !== 'number' || Number.isNaN(n) || n < 0 || n > 100) {
    throw new TraceError(ERR.VALIDATION, '心情评分需在 0-100 之间')
  }
  return Math.round(n * 100) / 100
}

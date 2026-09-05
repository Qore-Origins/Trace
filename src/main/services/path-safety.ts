// 路径安全与规范化（LLD §6.6）：所有渲染器传入路径的主进程入口防线
import { resolve, sep, isAbsolute } from 'node:path'
import { ERR, TraceError } from '../../shared/errors'

// 相对路径（'/' 分隔）规范化：空=根；去尾部分隔；统一 '/'
export function normalizeRel(rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (cleaned.includes('..')) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  return cleaned
}

// 相对路径 → 绝对路径；必须位于 rootAbs 内（防穿越）
export function resolveWithin(rootAbs: string, rel: string): { abs: string; rel: string } {
  const normalized = normalizeRel(rel)
  const abs = normalized === '' ? rootAbs : resolve(rootAbs, normalized)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  }
  if (isAbsolute(normalized)) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  return { abs, rel: normalized }
}

// 循环嵌套校验（LLD §6.2）：targetRel 是否位于 movingRel 自身/子孙链上
// 空串（根层）永不为任何计划的后代 → 允许
export function isSelfOrDescendant(movingRel: string, targetRel: string): boolean {
  if (movingRel === '') return false
  if (targetRel === movingRel) return true
  const prefix = movingRel + '/'
  return targetRel.startsWith(prefix)
}

// 父相对路径（纯字符串：'a/b'→'a'，'a'→''，''→''）
export function parentRel(rel: string): string {
  if (rel === '') return ''
  const idx = rel.lastIndexOf('/')
  return idx === -1 ? '' : rel.slice(0, idx)
}

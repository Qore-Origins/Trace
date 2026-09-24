// 路径安全（LLD §6.6）：所有渲染器传入路径的主进程入口防线
import { resolve, sep, isAbsolute } from 'node:path'
import { ERR, TraceError } from '../../shared/errors'
import { normalizeRel } from '../../shared/path-utils'

export { normalizeRel, parentRel, isSelfOrDescendant, baseName } from '../../shared/path-utils'

// 安全规范化：空=根；统一 '/'；拒绝 ..（越界意图）
export function normalizeRelSafe(rel: string): string {
  const cleaned = normalizeRel(rel)
  if (cleaned.includes('..')) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  return cleaned
}

// 相对路径 → 绝对路径；必须位于 rootAbs 内（防穿越）
export function resolveWithin(rootAbs: string, rel: string): { abs: string; rel: string } {
  const normalizedRoot = resolve(rootAbs)
  const normalized = normalizeRelSafe(rel)
  const abs = normalized === '' ? normalizedRoot : resolve(normalizedRoot, normalized)
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + sep)) {
    throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  }
  if (isAbsolute(normalized)) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
  return { abs, rel: normalized }
}

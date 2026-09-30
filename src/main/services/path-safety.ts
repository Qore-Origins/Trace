// 路径安全（LLD §6.6）：所有渲染器传入路径的主进程入口防线
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { promises as fs } from 'node:fs'
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

function isRealPathWithin(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

export async function assertRealPathWithinRoot(
  rootAbs: string,
  targetAbs: string,
  options: { allowMissing?: boolean } = {}
): Promise<void> {
  let rootReal: string
  try {
    rootReal = await fs.realpath(rootAbs)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TraceError(ERR.PATH_NOT_FOUND, '目标文件夹不存在')
    }
    throw error
  }

  const target = resolve(targetAbs)
  let targetReal: string
  try {
    targetReal = await fs.realpath(target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (!options.allowMissing) throw new TraceError(ERR.PATH_NOT_FOUND, '目标文件夹不存在')

    let candidate = target
    while (true) {
      try {
        await fs.lstat(candidate)
        try {
          targetReal = await fs.realpath(candidate)
        } catch (candidateError) {
          if ((candidateError as NodeJS.ErrnoException).code === 'ENOENT') {
            throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
          }
          throw candidateError
        }
        break
      } catch (candidateError) {
        if ((candidateError as NodeJS.ErrnoException).code !== 'ENOENT') throw candidateError
        const parent = dirname(candidate)
        if (parent === candidate) throw new TraceError(ERR.PATH_NOT_FOUND, '目标文件夹不存在')
        candidate = parent
      }
    }
  }

  if (!isRealPathWithin(rootReal, targetReal)) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
}

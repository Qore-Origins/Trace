// 纯路径工具（无 fs 依赖）：主进程与渲染器（拖拽校验）共享
// 相对路径统一 '/' 分隔；空串=根

export function normalizeRel(rel: string): string {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return cleaned
}

export function parentRel(rel: string): string {
  if (rel === '') return ''
  const idx = rel.lastIndexOf('/')
  return idx === -1 ? '' : rel.slice(0, idx)
}

export function baseName(rel: string): string {
  if (rel === '') return ''
  return rel.slice(rel.lastIndexOf('/') + 1)
}

// targetRel 是否位于 movingRel 自身/子孙链上（循环嵌套校验）
export function isSelfOrDescendant(movingRel: string, targetRel: string): boolean {
  if (movingRel === '') return false
  if (targetRel === movingRel) return true
  return targetRel.startsWith(movingRel + '/')
}

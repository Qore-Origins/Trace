export type DeletionTarget = 'tree' | 'component' | 'preset' | 'task' | 'option'
export function deletionPolicy(target: DeletionTarget): 'confirm' | 'undo' {
  return target === 'task' || target === 'option' ? 'undo' : 'confirm'
}

/** 同一确认只成功执行一次；失败允许用户在弹窗里重试。 */
export function onceAction(action: () => void | Promise<void>): () => Promise<void> {
  let pending: Promise<void> | null = null
  let completed = false
  return () => {
    if (completed) return Promise.resolve()
    if (pending) return pending
    pending = Promise.resolve().then(action).then(() => { completed = true }).finally(() => { pending = null })
    return pending
  }
}

export interface RemovedSnapshot<T> { item: T; index: number }
export function removeWithSnapshot<T extends { id: string }>(items: T[], id: string): RemovedSnapshot<T> | null {
  const index = items.findIndex(item => item.id === id)
  if (index < 0) return null
  const item = structuredClone(items[index])
  items.splice(index, 1)
  return { item, index }
}
export function restoreSnapshot<T extends { id: string }>(items: T[], snapshot: RemovedSnapshot<T>): void {
  if (items.some(item => item.id === snapshot.item.id)) return
  items.splice(Math.min(snapshot.index, items.length), 0, structuredClone(snapshot.item))
}

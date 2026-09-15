import { afterEach, describe, expect, it, vi } from 'vitest'
import { deletionPolicy, onceAction, removeWithSnapshot, restoreSnapshot } from '../src/renderer/src/components/ui/action-policy'
import { useUndoStore } from '../src/renderer/src/stores/undo-store'
import { removePlanRow } from '../src/renderer/src/components/ui/plan-row-actions'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import type { PlanDocument, TaskListPayload } from '../src/shared/plan-types'

afterEach(() => { useUndoStore.getState().clear(); usePlanStore.getState().close(); vi.useRealTimers() })
describe('真实计划行撤销', () => {
  function openSample(): void {
    vi.useFakeTimers()
    const document: PlanDocument = {
      format_version: '1', created_at: '2026-09-16T00:00:00Z', updated_at: '2026-09-16T00:00:00Z',
      components: [{ id: 'card', type: 'task_list', payload: { title: '列表', items: [{ id: 'a', title: 'A', status: 'not_started' }, { id: 'b', title: 'B', status: 'not_started' }] } }]
    }
    usePlanStore.setState({ currentPath: 'test', document, saveState: 'idle', externalAlert: false })
  }
  it('恢复单行且保留后续修改', () => {
    openSample()
    removePlanRow('card', 'task', 'a', 'A')
    usePlanStore.getState().mutate(doc => { (doc.components[0].payload as TaskListPayload).items[0].title = '最新' })
    useUndoStore.getState().undo()
    const items = (usePlanStore.getState().document!.components[0].payload as TaskListPayload).items
    expect(items.map(item => item.title)).toEqual(['A', '最新'])
  })
  it('切计划即清理快照，再回来也不能撤销', () => {
    openSample()
    removePlanRow('card', 'task', 'a', 'A')
    usePlanStore.setState({ currentPath: 'other' })
    expect(useUndoStore.getState().entry).toBeNull()
    usePlanStore.setState({ currentPath: 'test' })
    useUndoStore.getState().undo()
    expect((usePlanStore.getState().document!.components[0].payload as TaskListPayload).items).toHaveLength(1)
  })
  it('删除卡片后不会通过撤销把它复活', () => {
    openSample()
    removePlanRow('card', 'task', 'a', 'A')
    usePlanStore.getState().mutate(doc => { doc.components = [] })
    useUndoStore.getState().undo()
    expect(usePlanStore.getState().document!.components).toHaveLength(0)
  })
  it('重载与外部变更清理快照', () => {
    openSample()
    removePlanRow('card', 'task', 'a', 'A')
    usePlanStore.setState({ externalAlert: true })
    expect(useUndoStore.getState().entry).toBeNull()
  })
})
describe('删除策略与快照', () => {
  it('树、组件、预设确认；行和选项可撤销', () => {
    for (const kind of ['tree', 'component', 'preset'] as const) expect(deletionPolicy(kind)).toBe('confirm')
    for (const kind of ['task', 'option'] as const) expect(deletionPolicy(kind)).toBe('undo')
  })
  it('撤销恢复原索引且保留其他项最新编辑', () => {
    const items = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }]
    const snapshot = removeWithSnapshot(items, 'b')!
    items[0].title = '最新编辑'
    restoreSnapshot(items, snapshot)
    expect(items.map(item => item.id)).toEqual(['a', 'b', 'c'])
    expect(items[0].title).toBe('最新编辑')
    restoreSnapshot(items, snapshot)
    expect(items).toHaveLength(3)
  })
  it('快照与被删除对象隔离', () => {
    const item = { id: 'a', nested: { text: '原始' } }
    const snapshot = removeWithSnapshot([item], 'a')!
    item.nested.text = '改变'
    expect(snapshot.item.nested.text).toBe('原始')
  })
  it('重复确认仅执行一次', async () => {
    let count = 0
    const action = onceAction(async () => { count++ })
    await Promise.all([action(), action(), action()])
    expect(count).toBe(1)
  })
  it('失败确认可重试但不会并发重复', async () => {
    let count = 0
    const action = onceAction(async () => { if (++count === 1) throw new Error('失败') })
    await expect(action()).rejects.toThrow('失败')
    await action()
    expect(count).toBe(2)
  })
})
describe('单槽五秒撤销', () => {
  it('只保留最后一条且撤销只能执行一次', () => {
    vi.useFakeTimers()
    let result = ''
    useUndoStore.getState().register({ description: 'A', undo: () => { result = 'A' } })
    useUndoStore.getState().register({ description: 'B', undo: () => { result = 'B' } })
    useUndoStore.getState().undo()
    useUndoStore.getState().undo()
    expect(result).toBe('B')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('五秒过期清理且不执行撤销', () => {
    vi.useFakeTimers()
    let count = 0
    useUndoStore.getState().register({ description: 'A', undo: () => { count++ } })
    vi.advanceTimersByTime(5000)
    expect(useUndoStore.getState().entry).toBeNull()
    useUndoStore.getState().undo()
    expect(count).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('关闭提示清理定时器', () => {
    vi.useFakeTimers()
    useUndoStore.getState().register({ description: 'A', undo: () => undefined })
    useUndoStore.getState().clear()
    expect(vi.getTimerCount()).toBe(0)
  })
})

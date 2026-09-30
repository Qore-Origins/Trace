import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TraceBridge } from '../src/shared/ipc-contract'
import type { PlanDocument } from '../src/shared/plan-types'
import { ERR } from '../src/shared/errors'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useTreeStore } from '../src/renderer/src/stores/tree-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

const originalPath = 'Folder/A'
const movedPath = 'Other/A'

function document(): PlanDocument {
  return {
    format_version: '1',
    created_at: '2026-09-30T00:00:00.000Z',
    updated_at: 'server-0',
    components: [{ id: 'heading-1', type: 'heading', payload: { title: '原内容', size: 18 } }]
  }
}

bindAntdHost({} as never, { warning: vi.fn(), error: vi.fn() } as never)

afterEach(() => {
  usePlanStore.getState().close()
  useTreeStore.setState({ childrenMap: {}, loaded: {}, expandedKeys: [], selectedPath: null, selectedKind: null })
  useWorkspaceTabsStore.setState({ rootKey: null, restoreStatus: 'idle', library_id: '', open_paths: [], active_path: null })
  vi.restoreAllMocks()
})

describe('moving an active plan', () => {
  it('移动 IPC 等待期间的新输入最终保存到新路径，活动文档仍可继续编辑', async () => {
    const moving = deferred<{ ok: true; data: null }>()
    const saves: Array<{ path: string; document: PlanDocument }> = []
    const invoke = vi.fn(async (channel: string, request?: unknown) => {
      if (channel === 'storage:movePlan') return moving.promise
      if (channel === 'storage:treeGetChildren') return { ok: true, data: [] }
      if (channel === 'workspace-tabs:set') return { ok: true, data: null }
      if (channel === 'storage:readPlan') return { ok: true, data: document() }
      if (channel === 'storage:savePlan') {
        const payload = request as { path: string; document: PlanDocument }
        saves.push(payload)
        if (payload.path === originalPath) return { ok: false, code: ERR.NOT_FOUND, message: 'old path moved' }
        return { ok: true, data: { updated_at: `server-${saves.length}` } }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    globalThis.window = { trace: { invoke, on: vi.fn(() => () => undefined) } } as unknown as Window & typeof globalThis
    usePlanStore.setState({ currentPath: originalPath, document: document(), serverUpdatedAt: 'server-0', saveState: 'idle' })
    useWorkspaceTabsStore.setState({ rootKey: 'root-a', restoreStatus: 'ready', library_id: 'library-a', open_paths: [{ path: originalPath }], active_path: originalPath })

    const move = useTreeStore.getState().movePlan(originalPath, 'Other')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('storage:movePlan', { path: originalPath, target_parent_path: 'Other' }))
    usePlanStore.getState().patchComponent('heading-1', (component) => ({
      ...component,
      payload: { title: '移动期间输入', size: 18 }
    }))
    moving.resolve({ ok: true, data: null })

    expect(await move).toBe(true)
    expect(usePlanStore.getState().currentPath).toBe(movedPath)
    expect(useWorkspaceTabsStore.getState().active_path).toBe(movedPath)
    expect(await usePlanStore.getState().flush()).toBe(true)
    expect(saves.some((save) => save.path === originalPath)).toBe(false)
    expect(saves.some((save) => save.path === movedPath && save.document.components[0].payload.title === '移动期间输入')).toBe(true)
  })

  it('文件移动失败时释放保存门控，期间输入仍能保存到旧路径', async () => {
    const moving = deferred<{ ok: false; code: number; message: string }>()
    const saves: string[] = []
    const invoke = vi.fn(async (channel: string, request?: unknown) => {
      if (channel === 'storage:movePlan') return moving.promise
      if (channel === 'storage:savePlan') {
        saves.push((request as { path: string }).path)
        return { ok: true, data: { updated_at: 'server-1' } }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    globalThis.window = { trace: { invoke, on: vi.fn(() => () => undefined) } } as unknown as Window & typeof globalThis
    usePlanStore.setState({ currentPath: originalPath, document: document(), serverUpdatedAt: 'server-0', saveState: 'idle' })

    const move = useTreeStore.getState().movePlan(originalPath, 'Other')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('storage:movePlan', { path: originalPath, target_parent_path: 'Other' }))
    usePlanStore.getState().patchComponent('heading-1', (component) => ({ ...component, payload: { title: '失败期间输入', size: 18 } }))
    moving.resolve({ ok: false, code: ERR.CONFLICT, message: 'move failed' })

    expect(await move).toBe(false)
    expect(usePlanStore.getState().currentPath).toBe(originalPath)
    expect(saves).toEqual([originalPath])
  })

  it('磁盘移动成功但标签状态写盘失败时明确返回失败，编辑器仍指向新路径', async () => {
    const invoke = vi.fn(async (channel: string) => {
      if (channel === 'storage:movePlan') return { ok: true, data: null }
      if (channel === 'storage:treeGetChildren') return { ok: true, data: [] }
      if (channel === 'workspace-tabs:set') return { ok: false, code: ERR.INTERNAL, message: 'tab save failed' }
      return { ok: true, data: document() }
    })
    globalThis.window = { trace: { invoke, on: vi.fn(() => () => undefined) } } as unknown as Window & typeof globalThis
    usePlanStore.setState({ currentPath: originalPath, document: document(), serverUpdatedAt: 'server-0', saveState: 'idle' })
    useWorkspaceTabsStore.setState({ rootKey: 'root-a', restoreStatus: 'ready', library_id: 'library-a', open_paths: [{ path: originalPath }], active_path: originalPath })

    expect(await useTreeStore.getState().movePlan(originalPath, 'Other')).toBe(false)
    expect(usePlanStore.getState().currentPath).toBe(movedPath)
    expect(useWorkspaceTabsStore.getState().open_paths).toEqual([{ path: movedPath }])
  })
})

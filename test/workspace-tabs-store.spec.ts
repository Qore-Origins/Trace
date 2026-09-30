import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceTabsState } from '../src/shared/workspace-tabs-types'
import { createWorkspaceTabsStore, type WorkspaceTabsPort } from '../src/renderer/src/stores/workspace-tabs-store'

function setup(initial?: Partial<WorkspaceTabsState>) {
  const persisted: WorkspaceTabsState = {
    library_id: 'library-a',
    open_paths: [],
    active_path: null,
    ...initial
  }
  const calls: string[] = []
  const api: WorkspaceTabsPort = {
    load: vi.fn(async () => persisted),
    save: vi.fn(async () => undefined),
    flushPlan: vi.fn(async () => { calls.push('flush'); return true }),
    openPlan: vi.fn(async (path) => { calls.push(`open:${path}`); return true }),
    closePlan: vi.fn(() => { calls.push('close') })
  }
  return { store: createWorkspaceTabsStore(api), api, calls }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

describe('workspace tabs store', () => {
  it('重复打开同一路径只保留一个标签，并激活已有标签', async () => {
    const { store, api } = setup()
    await store.getState().hydrate('root-a')

    await store.getState().openPlan('Plans/A')
    await store.getState().openPlan('Plans/A')

    expect(store.getState().open_paths).toEqual([{ path: 'Plans/A' }])
    expect(store.getState().active_path).toBe('Plans/A')
    expect(api.openPlan).toHaveBeenCalledTimes(1)
  })

  it('激活另一项先 flush；失败时保留原活动标签', async () => {
    const { store, api, calls } = setup()
    await store.getState().hydrate('root-a')
    await store.getState().openPlan('Plans/A')
    await store.getState().openPlan('Plans/B')
    expect(calls.slice(-2)).toEqual(['flush', 'open:Plans/B'])

    vi.mocked(api.flushPlan).mockResolvedValueOnce(false)
    expect(await store.getState().activate('Plans/A')).toBe(false)
    expect(store.getState().active_path).toBe('Plans/B')
    expect(api.openPlan).toHaveBeenCalledTimes(2)
  })

  it('关闭活动项优先左邻，无左邻时选右邻；关闭非活动项不重载', async () => {
    const { store, api } = setup()
    await store.getState().hydrate('root-a')
    await store.getState().openPlan('A')
    await store.getState().openPlan('B')
    await store.getState().openPlan('C')

    await store.getState().closeTab('A')
    expect(api.openPlan).toHaveBeenCalledTimes(3)
    await store.getState().closeTab('C')
    expect(store.getState().active_path).toBe('B')
    await store.getState().closeTab('B')
    expect(store.getState().active_path).toBeNull()
    expect(api.closePlan).toHaveBeenCalledTimes(1)

    await store.getState().openPlan('A')
    await store.getState().openPlan('B')
    await store.getState().activate('A')
    await store.getState().closeTab('A')
    expect(store.getState().active_path).toBe('B')
  })

  it('关闭等待 flush 时另一计划打开成功，不覆盖新标签或重载旧邻项', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'A' }, { path: 'B' }], active_path: 'B' })
    await store.getState().hydrate('root-a')
    let finishFlush: ((success: boolean) => void) | undefined
    vi.mocked(api.flushPlan).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishFlush = resolve }))

    const closing = store.getState().closeTab('B')
    await store.getState().openPlan('C')
    finishFlush?.(true)
    await closing

    expect(store.getState().open_paths).toEqual([{ path: 'A' }, { path: 'C' }])
    expect(store.getState().active_path).toBe('C')
    expect(api.openPlan).toHaveBeenLastCalledWith('C')
  })

  it('切库立即隔离旧标签与迟到的载入结果', async () => {
    let finishOldLoad: ((state: WorkspaceTabsState) => void) | undefined
    const oldLoad = new Promise<WorkspaceTabsState>((resolve) => { finishOldLoad = resolve })
    const { store, api } = setup()
    vi.mocked(api.load)
      .mockImplementationOnce(() => oldLoad)
      .mockResolvedValueOnce({ library_id: 'library-b', open_paths: [{ path: 'B' }], active_path: 'B' })

    const oldHydration = store.getState().hydrate('root-a')
    await store.getState().hydrate('root-b')
    finishOldLoad?.({ library_id: 'library-a', open_paths: [{ path: 'A' }], active_path: 'A' })
    await oldHydration

    expect(store.getState().rootKey).toBe('root-b')
    expect(store.getState().open_paths).toEqual([{ path: 'B' }])
    expect(store.getState().active_path).toBe('B')
  })

  it('重命名或移动按路径边界迁移，并保留已有 plan_id', async () => {
    const { store, api } = setup({
      open_paths: [{ path: 'A', plan_id: 'plan-1' }, { path: 'A/Child', plan_id: 'plan-2' }, { path: 'AB' }],
      active_path: 'A/Child'
    })
    await store.getState().hydrate('root-a')
    await store.getState().remapPrefix('A', 'Moved/A')

    expect(store.getState().open_paths).toEqual([
      { path: 'Moved/A', plan_id: 'plan-1' },
      { path: 'Moved/A/Child', plan_id: 'plan-2' },
      { path: 'AB' }
    ])
    expect(store.getState().active_path).toBe('Moved/A/Child')
    expect(api.save).toHaveBeenCalledWith({
      library_id: 'library-a',
      open_paths: [
        { path: 'Moved/A', plan_id: 'plan-1' },
        { path: 'Moved/A/Child', plan_id: 'plan-2' },
        { path: 'AB' }
      ],
      active_path: 'Moved/A/Child'
    })
  })

  it('移动完成但新路径读取失败时仍迁移标签路径并清空无效活动项', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'A', plan_id: 'plan-1' }], active_path: 'A' })
    await store.getState().hydrate('root-a')
    vi.mocked(api.openPlan).mockResolvedValueOnce(false)

    await store.getState().remapPrefix('A', 'Moved/A')

    expect(store.getState().open_paths).toEqual([{ path: 'Moved/A', plan_id: 'plan-1' }])
    expect(store.getState().active_path).toBeNull()
  })

  it('删除子树关闭其中标签并选择仍存在的左邻', async () => {
    const { store, api } = setup({
      open_paths: [{ path: 'Before' }, { path: 'Folder/A' }, { path: 'Folder/B' }, { path: 'After' }],
      active_path: 'Folder/B'
    })
    await store.getState().hydrate('root-a')
    await store.getState().closeUnder('Folder')

    expect(store.getState().open_paths).toEqual([{ path: 'Before' }, { path: 'After' }])
    expect(store.getState().active_path).toBe('Before')
    expect(api.openPlan).toHaveBeenLastCalledWith('Before')
  })

  it('删除活动计划后若邻项读取失败，仍移除已删除路径', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'Before' }, { path: 'Folder/A' }], active_path: 'Folder/A' })
    await store.getState().hydrate('root-a')
    vi.mocked(api.openPlan).mockResolvedValueOnce(false)

    await store.getState().closeUnder('Folder')

    expect(store.getState().open_paths).toEqual([{ path: 'Before' }])
    expect(store.getState().active_path).toBeNull()
  })

  it('旧库活动项的迟到加载不能覆盖新库标签', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'A' }], active_path: 'A' })
    let finishOpen: ((success: boolean) => void) | undefined
    vi.mocked(api.openPlan).mockImplementationOnce(() => new Promise<boolean>((resolve) => { finishOpen = resolve }))
    vi.mocked(api.load).mockResolvedValueOnce({ library_id: 'library-a', open_paths: [{ path: 'A' }], active_path: 'A' })
      .mockResolvedValueOnce({ library_id: 'library-b', open_paths: [], active_path: null })

    const oldHydration = store.getState().hydrate('root-a')
    await Promise.resolve()
    await store.getState().hydrate('root-b')
    finishOpen?.(true)
    expect(await oldHydration).toBe(false)
    expect(store.getState().open_paths).toEqual([])
    expect(store.getState().active_path).toBeNull()
  })

  it('恢复 A 读取未完成时用户打开 B，迟到 A 不清空 B', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'A' }], active_path: 'A' })
    const oldOpen = deferred<boolean>()
    vi.mocked(api.openPlan).mockImplementationOnce(() => oldOpen.promise).mockResolvedValueOnce(true)
    const hydrating = store.getState().hydrate('root-a')
    await vi.waitFor(() => expect(api.openPlan).toHaveBeenCalledWith('A'))

    expect(await store.getState().openPlan('B')).toBe(true)
    oldOpen.resolve(false)
    await hydrating

    expect(store.getState().open_paths).toEqual([{ path: 'A' }, { path: 'B' }])
    expect(store.getState().active_path).toBe('B')
  })

  it('loading 时可开 B，配置读取失败后仍能开 C 且不写坏配置', async () => {
    const { store, api } = setup()
    const loading = deferred<WorkspaceTabsState>()
    vi.mocked(api.load).mockImplementationOnce(() => loading.promise)
    const hydrating = store.getState().hydrate('root-a')

    expect(await store.getState().openPlan('B')).toBe(true)
    loading.resolve({ library_id: 'library-a', open_paths: [{ path: 'A' }], active_path: 'A' })
    await hydrating
    expect(store.getState().active_path).toBe('B')

    await store.getState().hydrate(null)
    vi.mocked(api.load).mockRejectedValueOnce(new Error('malformed config'))
    expect(await store.getState().hydrate('root-a')).toBe(false)
    expect(await store.getState().openPlan('C')).toBe(true)
    expect(store.getState().active_path).toBe('C')
    expect(api.save).not.toHaveBeenCalledWith(expect.objectContaining({ library_id: '' }))
  })

  it('启动恢复中的用户打开失败时保留原标签，并可手动重新激活恢复项', async () => {
    const { store, api } = setup()
    const loading = deferred<WorkspaceTabsState>()
    vi.mocked(api.load).mockImplementationOnce(() => loading.promise)
    vi.mocked(api.openPlan).mockResolvedValueOnce(false)

    const hydrating = store.getState().hydrate('root-a')
    expect(await store.getState().openPlan('B')).toBe(false)
    loading.resolve({ library_id: 'library-a', open_paths: [{ path: 'A' }], active_path: 'A' })
    await hydrating

    expect(store.getState().open_paths).toEqual([{ path: 'A' }])
    expect(store.getState().active_path).toBeNull()
    expect(await store.getState().activate('A')).toBe(true)
    expect(store.getState().active_path).toBe('A')
    expect(api.openPlan).toHaveBeenLastCalledWith('A')
  })

  it('标签写盘失败后仍可继续打开计划', async () => {
    const { store, api } = setup()
    await store.getState().hydrate('root-a')
    vi.mocked(api.save).mockRejectedValueOnce(new Error('temporary save failure'))

    await store.getState().openPlan('A')
    expect(await store.getState().openPlan('B')).toBe(true)
    expect(store.getState().active_path).toBe('B')
    expect(store.getState().restoreStatus).toBe('ready')
  })

  it('删除子树等待邻项读取时，并发打开 B 保留 B', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'A' }, { path: 'Folder/X' }], active_path: 'Folder/X' })
    await store.getState().hydrate('root-a')
    const neighbor = deferred<boolean>()
    vi.mocked(api.openPlan).mockImplementationOnce(() => neighbor.promise).mockResolvedValueOnce(true)

    const closing = store.getState().closeUnder('Folder')
    expect(await store.getState().openPlan('B')).toBe(true)
    neighbor.resolve(false)
    await closing
    expect(store.getState().open_paths).toEqual([{ path: 'A' }, { path: 'B' }])
    expect(store.getState().active_path).toBe('B')
  })

  it('路径迁移等待读取时，并发打开 B 不丢失 B', async () => {
    const { store, api } = setup({ open_paths: [{ path: 'Folder/X' }], active_path: 'Folder/X' })
    await store.getState().hydrate('root-a')
    const movedOpen = deferred<boolean>()
    vi.mocked(api.openPlan).mockImplementationOnce(() => movedOpen.promise).mockResolvedValueOnce(true)

    const remapping = store.getState().remapPrefix('Folder', 'Moved')
    await vi.waitFor(() => expect(api.openPlan).toHaveBeenCalledWith('Moved/X'))
    expect(await store.getState().openPlan('B')).toBe(true)
    movedOpen.resolve(false)
    await remapping
    expect(store.getState().open_paths).toEqual([{ path: 'Moved/X' }, { path: 'B' }])
    expect(store.getState().active_path).toBe('B')
  })
})

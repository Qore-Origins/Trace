import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Component, HeadingPayload, PlanDocument } from '../src/shared/plan-types'
import type { TraceBridge } from '../src/shared/ipc-contract'
import { ERR } from '../src/shared/errors'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { createCardRegistry } from '../src/renderer/src/components/cards/card-registry'
import { subscribePlanEvents, usePlanStore } from '../src/renderer/src/stores/plan-store'

function createDocument(componentCount = 100): PlanDocument {
  return {
    format_version: '1',
    created_at: '2026-09-16T00:00:00.000Z',
    updated_at: '2026-09-16T00:00:00.000Z',
    components: Array.from({ length: componentCount }, (_, index): Component => ({
      id: `component-${index}`,
      type: 'heading',
      payload: { title: `标题 ${index}`, size: 18 }
    }))
  }
}

function installBridge(invoke: TraceBridge['invoke'], on?: TraceBridge['on']): void {
  const trace = {
    invoke,
    on: on ?? vi.fn(() => () => undefined)
  } as unknown as TraceBridge
  globalThis.window = { trace } as unknown as Window & typeof globalThis
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

bindAntdHost({} as never, { warning: vi.fn(), error: vi.fn() } as never)

afterEach(() => {
  usePlanStore.getState().close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('组件级计划编辑', () => {
  it('只替换目标组件引用，并以原 CAS 锚点保存最新完整快照', async () => {
    vi.useFakeTimers()
    const savedRequests: Array<{ document: PlanDocument; expected_updated_at: string }> = []
    installBridge(vi.fn(async (channel, request) => {
      expect(channel).toBe('storage:savePlan')
      const saveRequest = request as { document: PlanDocument; expected_updated_at: string }
      savedRequests.push(saveRequest)
      return { ok: true, data: { updated_at: '2026-09-16T00:00:01.000Z' } }
    }) as TraceBridge['invoke'])

    const document = createDocument()
    const beforeComponents = document.components
    usePlanStore.setState({
      currentPath: 'plans/performance.json',
      document,
      serverUpdatedAt: document.updated_at,
      saveState: 'idle',
      lastError: null,
      externalAlert: false
    })

    usePlanStore.getState().patchComponent('component-50', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '已编辑' }
    }))

    const edited = usePlanStore.getState().document!
    expect(edited).not.toBe(document)
    expect(edited.components).not.toBe(beforeComponents)
    expect(edited.components[50]).not.toBe(beforeComponents[50])
    expect(edited.components[50].payload).not.toBe(beforeComponents[50].payload)
    for (let index = 0; index < edited.components.length; index += 1) {
      if (index !== 50) expect(edited.components[index]).toBe(beforeComponents[index])
    }

    await usePlanStore.getState().flush()

    expect(savedRequests).toHaveLength(1)
    expect(savedRequests[0].expected_updated_at).toBe(document.updated_at)
    expect((savedRequests[0].document.components[50].payload as HeadingPayload).title).toBe('已编辑')
  })

  it('由注册表统一提供 memo 卡片，稳定属性不会重渲染无关卡片', () => {
    const NoteCard = (): React.JSX.Element => createElement('div')
    const registry = createCardRegistry(NoteCard)
    const memoType = Symbol.for('react.memo')

    for (const renderer of Object.values(registry)) {
      expect((renderer as unknown as { $$typeof?: symbol }).$$typeof).toBe(memoType)
    }
  })

  it('保存中继续输入时保留 editing 状态并用新锚点保存最后一次输入', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<{ ok: true; data: { updated_at: string } }>()
    const requests: Array<{ document: PlanDocument; expected_updated_at: string }> = []
    installBridge(vi.fn(async (channel, request) => {
      expect(channel).toBe('storage:savePlan')
      requests.push(request as { document: PlanDocument; expected_updated_at: string })
      if (requests.length === 1) return firstSave.promise
      return { ok: true, data: { updated_at: 'server-2' } }
    }) as TraceBridge['invoke'])
    const document = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/a.json', document, serverUpdatedAt: 'server-0', saveState: 'idle' })

    usePlanStore.getState().patchComponent('component-0', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '第一次输入' }
    }))
    vi.clearAllTimers()
    const flushing = usePlanStore.getState().flush()
    usePlanStore.getState().patchComponent('component-0', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '最后一次输入' }
    }))

    firstSave.resolve({ ok: true, data: { updated_at: 'server-1' } })
    await flushing
    expect(usePlanStore.getState().saveState).toBe('editing')

    await vi.advanceTimersByTimeAsync(500)
    expect(requests).toHaveLength(2)
    expect(requests[1].expected_updated_at).toBe('server-1')
    expect((requests[1].document.components[0].payload as HeadingPayload).title).toBe('最后一次输入')
    expect(usePlanStore.getState().serverUpdatedAt).toBe('server-2')
  })

  it('切换计划后丢弃旧保存结果与旧计划的待保存编辑', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<{ ok: true; data: { updated_at: string } }>()
    const newDocument = createDocument(1)
    newDocument.updated_at = 'new-server-0'
    ;(newDocument.components[0].payload as HeadingPayload).title = '新计划'
    let saveCount = 0
    installBridge(vi.fn(async (channel) => {
      if (channel === 'storage:readPlan') return { ok: true, data: newDocument }
      saveCount += 1
      return firstSave.promise
    }) as TraceBridge['invoke'])
    const oldDocument = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/old.json', document: oldDocument, serverUpdatedAt: 'old-server-0', saveState: 'idle' })
    usePlanStore.getState().patchComponent('component-0', (component) => component)
    vi.clearAllTimers()
    const flushing = usePlanStore.getState().flush()
    usePlanStore.getState().patchComponent('component-0', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '旧计划未保存输入' }
    }))

    await usePlanStore.getState().open('plans/new.json')
    firstSave.resolve({ ok: true, data: { updated_at: 'old-server-1' } })
    await flushing
    await vi.advanceTimersByTimeAsync(500)

    expect(saveCount).toBe(1)
    expect(usePlanStore.getState().currentPath).toBe('plans/new.json')
    expect(usePlanStore.getState().document).toBe(newDocument)
    expect(usePlanStore.getState().serverUpdatedAt).toBe('new-server-0')
  })

  it('计划切换读取期间立即清空旧文档，阻止把旧内容编辑进新会话', async () => {
    const reading = deferred<{ ok: true; data: PlanDocument }>()
    installBridge(vi.fn(async () => reading.promise) as TraceBridge['invoke'])
    const oldDocument = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/old.json', document: oldDocument, serverUpdatedAt: 'old-server-0', saveState: 'idle' })

    const opening = usePlanStore.getState().open('plans/new.json')

    expect(usePlanStore.getState().currentPath).toBe('plans/new.json')
    expect(usePlanStore.getState().document).toBeNull()
    const newDocument = createDocument(1)
    newDocument.updated_at = 'new-server-0'
    reading.resolve({ ok: true, data: newDocument })
    await opening
    expect(usePlanStore.getState().document).toBe(newDocument)
  })

  it('CAS 冲突期间有新输入时保留本地最新值，并以服务端新锚点重试', async () => {
    vi.useFakeTimers()
    const firstSave = deferred<{ ok: false; code: number; message: string }>()
    const freshDocument = createDocument(2)
    freshDocument.updated_at = 'server-fresh'
    ;(freshDocument.components[0].payload as HeadingPayload).title = '外部内容'
    ;(freshDocument.components[1].payload as HeadingPayload).title = '外部未冲突更新'
    const requests: Array<{ document: PlanDocument; expected_updated_at: string }> = []
    installBridge(vi.fn(async (channel, request) => {
      if (channel === 'storage:readPlan') return { ok: true, data: freshDocument }
      requests.push(request as { document: PlanDocument; expected_updated_at: string })
      if (requests.length === 1) return firstSave.promise
      return { ok: true, data: { updated_at: 'server-final' } }
    }) as TraceBridge['invoke'])
    const document = createDocument(2)
    usePlanStore.setState({ currentPath: 'plans/a.json', document, serverUpdatedAt: 'server-0', saveState: 'idle' })
    usePlanStore.getState().patchComponent('component-0', (component) => component)
    vi.clearAllTimers()
    const flushing = usePlanStore.getState().flush()
    usePlanStore.getState().patchComponent('component-0', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '冲突后的最后输入' }
    }))

    firstSave.resolve({ ok: false, code: ERR.CONFLICT, message: 'conflict' })
    await flushing
    expect((usePlanStore.getState().document!.components[0].payload as HeadingPayload).title).toBe('冲突后的最后输入')
    expect(usePlanStore.getState().serverUpdatedAt).toBe('server-fresh')

    await vi.advanceTimersByTimeAsync(500)
    expect(requests).toHaveLength(2)
    expect(requests[1].expected_updated_at).toBe('server-fresh')
    expect((requests[1].document.components[0].payload as HeadingPayload).title).toBe('冲突后的最后输入')
    expect((requests[1].document.components[1].payload as HeadingPayload).title).toBe('外部未冲突更新')
  })

  it('CAS 重放不会再次执行可能生成 ID 的组件 patch 回调', async () => {
    vi.useFakeTimers()
    let patchCalls = 0
    let saveCalls = 0
    const freshDocument = createDocument(1)
    freshDocument.updated_at = 'server-fresh'
    installBridge(vi.fn(async (channel) => {
      if (channel === 'storage:readPlan') return { ok: true, data: freshDocument }
      saveCalls += 1
      if (saveCalls === 1) return { ok: false, code: ERR.CONFLICT, message: 'conflict' }
      return { ok: true, data: { updated_at: 'server-final' } }
    }) as TraceBridge['invoke'])
    const document = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/a.json', document, serverUpdatedAt: 'server-0', saveState: 'idle' })

    usePlanStore.getState().patchComponent('component-0', (component) => {
      patchCalls += 1
      return {
        ...component,
        payload: { ...(component.payload as HeadingPayload), title: `generated-${patchCalls}` }
      }
    })
    vi.clearAllTimers()
    await usePlanStore.getState().flush()
    await vi.advanceTimersByTimeAsync(500)

    expect(patchCalls).toBe(1)
    expect((usePlanStore.getState().document!.components[0].payload as HeadingPayload).title).toBe('generated-1')
  })

  it('删除当前计划触发 close 后不会让在途保存恢复旧文档', async () => {
    vi.useFakeTimers()
    const saving = deferred<{ ok: true; data: { updated_at: string } }>()
    let saveCount = 0
    installBridge(vi.fn(async () => {
      saveCount += 1
      return saving.promise
    }) as TraceBridge['invoke'])
    const document = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/deleted.json', document, serverUpdatedAt: 'server-0', saveState: 'idle' })
    usePlanStore.getState().patchComponent('component-0', (component) => component)
    vi.clearAllTimers()
    const flushing = usePlanStore.getState().flush()

    usePlanStore.getState().close()
    saving.resolve({ ok: true, data: { updated_at: 'server-1' } })
    await flushing
    await vi.advanceTimersByTimeAsync(500)

    expect(saveCount).toBe(1)
    expect(usePlanStore.getState().currentPath).toBeNull()
    expect(usePlanStore.getState().document).toBeNull()
  })

  it('编辑期间收到外部变更事件时不覆盖本地输入', () => {
    const callbacks = new Map<string, (payload: unknown) => void>()
    installBridge(
      vi.fn(async () => ({ ok: true, data: createDocument(1) })) as TraceBridge['invoke'],
      vi.fn((event, callback) => {
        callbacks.set(event, callback as (payload: unknown) => void)
        return () => callbacks.delete(event)
      }) as TraceBridge['on']
    )
    const document = createDocument(1)
    usePlanStore.setState({ currentPath: 'plans/a.json', document, serverUpdatedAt: 'server-0', saveState: 'idle' })
    usePlanStore.getState().patchComponent('component-0', (component) => ({
      ...component,
      payload: { ...(component.payload as HeadingPayload), title: '本地输入' }
    }))
    const unsubscribe = subscribePlanEvents()

    callbacks.get('trace:plan-changed')?.({ path: 'plans/a.json' })

    expect((usePlanStore.getState().document!.components[0].payload as HeadingPayload).title).toBe('本地输入')
    unsubscribe()
  })
})

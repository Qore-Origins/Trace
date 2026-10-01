// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from '../src/shared/plan-types'
import type { TraceBridge, PlanReferenceResolution } from '../src/shared/ipc-contract'
import { PlanReferenceCard } from '../src/renderer/src/components/cards/PlanReferenceCard'
import { i18n } from '../src/renderer/src/i18n'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const LIBRARY_ID = '11111111111111111111111111111111'
const TARGET_PLAN_ID = '33333333333333333333333333333333'
const UNRELATED_PLAN_ID = '55555555555555555555555555555555'
const TARGET_COMPONENT_ID = '44444444444444444444444444444444'
const SOURCE_PATH = 'Daily_Plan/Source'
const TARGET_PATH = 'Future_Plan/Current Target'
const RENAMED_TARGET_PATH = 'Future_Plan/Renamed Target'

function reference(
  id: string,
  mode: 'link' | 'embed',
  componentId?: string,
  name = 'Saved target name',
  targetPlanId = TARGET_PLAN_ID
): Component {
  return {
    id,
    type: 'plan_reference',
    payload: {
      mode,
      target_plan_id: targetPlanId,
      ...(componentId ? { target_component_id: componentId } : {}),
      target_path_snapshot: 'Future_Plan/Old Target Name',
      target_name_snapshot: name
    }
  }
}

function targetComponent(title: string): Component {
  return {
    id: TARGET_COMPONENT_ID,
    type: 'task_list',
    payload: {
      title,
      items: [{ id: 'task-1', title: 'Read-only task', status: 'in_progress', planned_at: '2026-10-02' }]
    }
  }
}

function found(component?: Component, path = TARGET_PATH): PlanReferenceResolution {
  return {
    status: 'found',
    target: {
      plan_id: TARGET_PLAN_ID,
      path,
      plan_name: 'Current target',
      ...(component ? { component_id: component.id, component_type: component.type as Exclude<Component['type'], 'plan_reference'>, component_name: 'Current component' } : {})
    },
    ...(component ? { component } : {})
  }
}

function installBridge(invoke: TraceBridge['invoke'], on: TraceBridge['on']): void {
  Object.defineProperty(window, 'trace', { configurable: true, value: { invoke, on } })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function wrap(comp: Component): React.JSX.Element {
  return createElement(
    DndContext,
    null,
    createElement(SortableContext, { items: [comp.id], strategy: verticalListSortingStrategy },
      createElement(PlanReferenceCard, { comp, index: 0, total: 1, today: new Date('2026-10-01T00:00:00') }))
  )
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let previousActEnvironment: unknown
let previousLanguage: string
let previousPlanState: ReturnType<typeof usePlanStore.getState>
let previousTabsState: ReturnType<typeof useWorkspaceTabsStore.getState>
let invokeMock: ReturnType<typeof vi.fn>
let openPlan: ReturnType<typeof vi.fn>
let eventCallbacks: Map<string, (payload: unknown) => void>

async function renderCard(comp: Component): Promise<void> {
  const current = usePlanStore.getState().document
  if (current) usePlanStore.setState({ document: { ...current, components: [comp] } })
  await act(async () => {
    root.render(wrap(comp))
  })
}

function button(label: string): HTMLButtonElement {
  const target = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label)
  if (!target) throw new Error(`Button not found: ${label}`)
  return target
}

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  previousLanguage = i18n.language
  previousPlanState = usePlanStore.getState()
  previousTabsState = useWorkspaceTabsStore.getState()
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')

  usePlanStore.setState({
    currentPath: SOURCE_PATH,
    document: { format_version: '1', plan_id: '22222222222222222222222222222222', created_at: '', updated_at: '', components: [] },
    sessionRevision: 1,
    serverUpdatedAt: 'source-stamp',
    saveState: 'idle',
    lastError: null,
    externalAlert: false
  })
  openPlan = vi.fn(async () => true)
  useWorkspaceTabsStore.setState({
    rootKey: 'root-a',
    library_id: LIBRARY_ID,
    open_paths: [{ path: SOURCE_PATH }],
    active_path: SOURCE_PATH,
    restoreStatus: 'ready',
    openPlan
  })
  eventCallbacks = new Map()
  invokeMock = vi.fn(async (channel: string) => {
    if (channel === 'plan-reference:resolve') return { ok: true, data: found(targetComponent('Initial title')) }
    throw new Error(`Unexpected channel: ${channel}`)
  })
  const on = vi.fn((event: string, callback: (payload: unknown) => void) => {
    eventCallbacks.set(event, callback)
    return () => eventCallbacks.delete(event)
  })
  installBridge(invokeMock as unknown as TraceBridge['invoke'], on as unknown as TraceBridge['on'])

  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  usePlanStore.getState().close()
  usePlanStore.setState(previousPlanState)
  useWorkspaceTabsStore.setState(previousTabsState)
  await i18n.changeLanguage(previousLanguage)
  Reflect.deleteProperty(window, 'trace')
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  vi.restoreAllMocks()
})

describe('PlanReferenceCard', () => {
  it('resolves a plan link by stable identity and opens its current path', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:resolve') return { ok: true, data: found() }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderCard(reference('source-ref-plan', 'link'))
    await vi.waitFor(() => expect(host.querySelector('[data-reference-status="found"]')).not.toBeNull())

    await act(async () => { button('打开关联').click() })

    expect(invokeMock).toHaveBeenCalledWith('plan-reference:resolve', {
      library_id: LIBRARY_ID,
      plan_id: TARGET_PLAN_ID
    })
    expect(openPlan).toHaveBeenCalledExactlyOnceWith(TARGET_PATH)
  })

  it('opens a component link at its current plan and focuses the component ID', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:resolve') return { ok: true, data: found(targetComponent('Current title')) }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderCard(reference('source-ref-component', 'link', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('[data-reference-status="found"]')).not.toBeNull())

    await act(async () => { button('打开关联').click() })

    expect(openPlan).toHaveBeenCalledExactlyOnceWith(TARGET_PATH, TARGET_COMPONENT_ID)
  })

  it('shows an explicit edit-original action for an embedded component', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:resolve') return { ok: true, data: found(targetComponent('Original title')) }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderCard(reference('source-ref-embed-open', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Original title'))

    await act(async () => { button('编辑原件').click() })

    expect(openPlan).toHaveBeenCalledExactlyOnceWith(TARGET_PATH, TARGET_COMPONENT_ID)
  })

  it('refreshes every mounted live embed after its resolved target plan changes', async () => {
    let revision = 0
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:resolve') {
        revision += 1
        return { ok: true, data: found(targetComponent(revision === 1 ? 'Before save' : 'After save')) }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderCard(reference('source-ref-refresh', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Before save'))

    await act(async () => {
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [TARGET_PLAN_ID] })
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('After save'))
    })

    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'plan-reference:resolve')).toHaveLength(2)
  })

  it('ignores unrelated plan saves and refreshes only when its stable target ID changes', async () => {
    let revision = 0
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel !== 'plan-reference:resolve') throw new Error(`Unexpected channel: ${channel}`)
      revision += 1
      return { ok: true, data: found(targetComponent(revision === 1 ? 'Initial target' : 'Updated target')) }
    })
    await renderCard(reference('source-ref-targeted-refresh', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Initial target'))

    await act(async () => {
      eventCallbacks.get('trace:plan-changed')?.({ path: 'Unrelated' })
      await Promise.resolve()
    })
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'plan-reference:resolve')).toHaveLength(1)

    await act(async () => {
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [UNRELATED_PLAN_ID] })
      await Promise.resolve()
    })
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'plan-reference:resolve')).toHaveLength(1)

    await act(async () => {
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [TARGET_PLAN_ID] })
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Updated target'))
    })
    expect(invokeMock.mock.calls.filter(([channel]) => channel === 'plan-reference:resolve')).toHaveLength(2)
  })

  it('retries once when its target changes while the initial resolve is pending', async () => {
    const pending = deferred<{ ok: true; data: PlanReferenceResolution }>()
    let resolveCalls = 0
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel !== 'plan-reference:resolve') throw new Error(`Unexpected channel: ${channel}`)
      resolveCalls += 1
      if (resolveCalls === 1) return pending.promise
      return { ok: true, data: found(targetComponent('Fresh after in-flight change')) }
    })
    await renderCard(reference('source-ref-inflight-refresh', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(resolveCalls).toBe(1))

    await act(async () => {
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [TARGET_PLAN_ID] })
      pending.resolve({ ok: true, data: found(targetComponent('Stale in-flight result')) })
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent)
        .toContain('Fresh after in-flight change'))
    })

    expect(host.querySelector('.plan-reference__preview')?.textContent).not.toContain('Stale in-flight result')
    expect(resolveCalls).toBe(2)
  })

  it('recovers an initial resolve invalidated by an unrelated plan change without refreshing found embeds', async () => {
    let rejectFirstResolve: (error: Error) => void = () => {}
    let resolveCalls = 0
    const invalidated = new Promise<{ ok: true; data: PlanReferenceResolution }>((_resolve, reject) => {
      rejectFirstResolve = reject
    })
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel !== 'plan-reference:resolve') throw new Error(`Unexpected channel: ${channel}`)
      resolveCalls += 1
      if (resolveCalls === 1) return invalidated
      return { ok: true, data: found(targetComponent('Loaded after unrelated change')) }
    })
    await renderCard(reference('source-ref-initial-unrelated-change', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(resolveCalls).toBe(1))

    await act(async () => {
      eventCallbacks.get('trace:plan-changed')?.({ path: 'Unrelated' })
      rejectFirstResolve(new Error('Plan revision changed during scan'))
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent)
        .toContain('Loaded after unrelated change'))
    })
    expect(resolveCalls).toBe(2)

    await act(async () => {
      eventCallbacks.get('trace:plan-changed')?.({ path: 'Unrelated again' })
      await Promise.resolve()
    })
    expect(resolveCalls).toBe(2)
  })

  it('re-resolves a moved target by stable IDs and refreshes later saves at its new path', async () => {
    let targetPath = TARGET_PATH
    let revision = 0
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel !== 'plan-reference:resolve') throw new Error(`Unexpected channel: ${channel}`)
      revision += 1
      const title = revision === 1 ? 'Before move' : revision === 2 ? 'After move' : 'After later save'
      return { ok: true, data: found(targetComponent(title), targetPath) }
    })
    await renderCard(reference('source-ref-moved-target', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Before move'))

    await act(async () => {
      targetPath = RENAMED_TARGET_PATH
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [TARGET_PLAN_ID] })
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('After move'))
    })

    await act(async () => {
      eventCallbacks.get('trace:reference-target-changed')?.({ plan_ids: [TARGET_PLAN_ID] })
      await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('After later save'))
    })

    const resolveRequests = invokeMock.mock.calls
      .filter(([channel]) => channel === 'plan-reference:resolve')
      .map(([, request]) => request)
    expect(resolveRequests).toEqual(Array.from({ length: 3 }, () => ({
      library_id: LIBRARY_ID,
      plan_id: TARGET_PLAN_ID,
      component_id: TARGET_COMPONENT_ID
    })))
  })

  it('renders embedded native components without interactive source controls', async () => {
    await renderCard(reference('source-ref-readonly', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Initial title'))
    const preview = host.querySelector('.plan-reference__preview')

    expect(preview?.querySelector('input, button, textarea, select')).toBeNull()
    expect(preview?.textContent).toContain('Read-only task')
    expect(preview?.querySelector('[aria-checked]')).toBeNull()
  })

  it('degrades a missing target locally without breaking a sibling embed', async () => {
    const missingPlanId = '55555555555555555555555555555555'
    const missing = reference('source-ref-missing', 'embed', TARGET_COMPONENT_ID, 'Missing embed', missingPlanId)
    const available = reference('source-ref-available', 'embed', TARGET_COMPONENT_ID, 'Available embed')
    invokeMock.mockImplementation(async (channel: string, request: unknown) => {
      if (channel !== 'plan-reference:resolve') throw new Error(`Unexpected channel: ${channel}`)
      const planId = (request as { plan_id: string }).plan_id
      return planId === missingPlanId
        ? { ok: true, data: { status: 'missing' } }
        : { ok: true, data: found(targetComponent('Sibling remains')) }
    })

    await act(async () => {
      const current = usePlanStore.getState().document
      if (current) usePlanStore.setState({ document: { ...current, components: [missing, available] } })
      root.render(createElement(
        DndContext,
        null,
        createElement(SortableContext, { items: [missing.id, available.id], strategy: verticalListSortingStrategy },
          createElement(PlanReferenceCard, { comp: missing, index: 0, total: 2, today: new Date() }),
          createElement(PlanReferenceCard, { comp: available, index: 1, total: 2, today: new Date() })
        )
      ))
    })
    await vi.waitFor(() => expect(host.querySelectorAll('[data-reference-status="missing"]')).toHaveLength(1))

    expect(host.querySelector('.plan-reference__missing')?.textContent).toContain('目标不存在')
    expect(host.querySelector('.plan-reference__preview')?.textContent).toContain('Sibling remains')
  })

  it('does not render a resolution that finishes after the source plan generation changes', async () => {
    const pending = deferred<{ ok: true; data: PlanReferenceResolution }>()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:resolve') return pending.promise
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderCard(reference('source-ref-stale', 'embed', TARGET_COMPONENT_ID))
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce())

    await act(async () => {
      usePlanStore.setState({ currentPath: 'Daily_Plan/Next', sessionRevision: 2 })
      pending.resolve({ ok: true, data: found(targetComponent('Stale response')) })
      await Promise.resolve()
    })

    expect(host.querySelector('.plan-reference__preview')?.textContent ?? '').not.toContain('Stale response')
    expect(host.querySelector('[data-reference-status="stale"]')).not.toBeNull()
  })

  it('edits the local display-name snapshot without recommitting target identity', async () => {
    const comp = reference('source-ref-edit-name', 'link', TARGET_COMPONENT_ID, 'Old snapshot')
    await renderCard(comp)
    await vi.waitFor(() => expect(host.querySelector('[data-reference-status="found"]')).not.toBeNull())
    await act(async () => { button('编辑显示名称').click() })

    const nameInput = host.querySelector<HTMLInputElement>('input[aria-label="显示名称"]')
    expect(nameInput?.value).toBe('Old snapshot')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (!setter || !nameInput) throw new Error('Display-name editor missing')
    await act(async () => {
      setter.call(nameInput, 'Local snapshot')
      nameInput.dispatchEvent(new Event('input', { bubbles: true }))
      button('保存名称').click()
    })

    expect((usePlanStore.getState().document?.components[0]?.payload as { target_name_snapshot: string }).target_name_snapshot).toBe('Local snapshot')
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })
})

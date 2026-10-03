// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component, PlanDocument } from '../src/shared/plan-types'
import type { PlanReferencePayload } from '../src/shared/plan-reference-types'
import type { TraceBridge } from '../src/shared/ipc-contract'
import { PlanReferencePicker, type PlanReferencePickerSource } from '../src/renderer/src/components/PlanReferencePicker'
import { i18n } from '../src/renderer/src/i18n'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const LIBRARY_ID = '11111111111111111111111111111111'
const SOURCE_PLAN_ID = '22222222222222222222222222222222'
const TARGET_PLAN_ID = '33333333333333333333333333333333'
const TARGET_COMPONENT_ID = '44444444444444444444444444444444'

const source: PlanReferencePickerSource = {
  path: 'Daily_Plan/Source',
  rootKey: 'root-a',
  libraryId: LIBRARY_ID,
  sessionRevision: 1
}

const planTarget = {
  path: 'Future_Plan/Target',
  plan_name: 'Target plan',
  plan_id: TARGET_PLAN_ID
}

const componentTarget = {
  ...planTarget,
  component_id: TARGET_COMPONENT_ID,
  component_type: 'task_list' as const,
  component_name: 'Weekly tasks'
}

function createSourceDocument(): PlanDocument {
  return {
    format_version: '1',
    plan_id: SOURCE_PLAN_ID,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    components: []
  }
}

function installBridge(invoke: TraceBridge['invoke'], on?: TraceBridge['on']): void {
  Object.defineProperty(window, 'trace', {
    configurable: true,
    value: { invoke, on: on ?? vi.fn(() => () => undefined) }
  })
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
    .find((candidate) => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Button not found: ${label}`)
  return button
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Native input value setter missing')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let previousActEnvironment: unknown
let previousLanguage: string
let previousPlanState: ReturnType<typeof usePlanStore.getState>
let previousTabsState: ReturnType<typeof useWorkspaceTabsStore.getState>
let invokeMock: ReturnType<typeof vi.fn>
let onClose: ReturnType<typeof vi.fn>

async function renderPicker(replacement?: { componentId: string; payload: PlanReferencePayload }): Promise<void> {
  await act(async () => {
    root.render(createElement(PlanReferencePicker, { open: true, source, onClose, replacement }))
  })
}

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  previousLanguage = i18n.language
  previousPlanState = usePlanStore.getState()
  previousTabsState = useWorkspaceTabsStore.getState()
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')

  usePlanStore.setState({
    currentPath: source.path,
    document: createSourceDocument(),
    sessionRevision: source.sessionRevision,
    serverUpdatedAt: '2026-10-01T00:00:00.000Z',
    saveState: 'idle',
    lastError: null,
    externalAlert: false
  })
  useWorkspaceTabsStore.setState({
    rootKey: source.rootKey,
    library_id: source.libraryId,
    open_paths: [{ path: source.path }],
    active_path: source.path,
    restoreStatus: 'ready'
  })

  invokeMock = vi.fn(async (channel: string, request: unknown) => {
    if (channel === 'plan-reference:search') return { ok: true, data: { targets: [planTarget, componentTarget] } }
    if (channel === 'plan-reference:commitTarget') {
      const target = request as { path: string; component_id?: string; mode: 'link' | 'embed' }
      return {
        ok: true,
        data: {
          plan_id: TARGET_PLAN_ID,
          path: target.path,
          plan_name: 'Target plan',
          ...(target.component_id ? { component_id: target.component_id, component_type: 'task_list', component_name: 'Weekly tasks' } : {})
        }
      }
    }
    throw new Error(`Unexpected channel: ${channel}`)
  })
  installBridge(invokeMock as unknown as TraceBridge['invoke'])

  onClose = vi.fn()
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

describe('PlanReferencePicker', () => {
  it.each(['link', 'embed'] as const)('replaces a broken %s in place, preserving its mode, component identity and remark', async (mode) => {
    const payload: PlanReferencePayload = { mode, target_plan_id: '99999999999999999999999999999999',
      ...(mode === 'embed' ? { target_component_id: '88888888888888888888888888888888' } : {}),
      target_path_snapshot: 'Missing', target_name_snapshot: 'Old label' }
    usePlanStore.setState({ document: { ...createSourceDocument(), components: [{ id: 'existing-ref', type: 'plan_reference', remark: '**Keep remark**', payload }] } })
    await renderPicker({ componentId: 'existing-ref', payload })
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())
    expect(findButton(mode === 'link' ? '软链接' : '普通关联').disabled).toBe(true)
    if (mode === 'embed') expect(document.querySelector('[role="option"][data-target-kind="plan"]')).toBeNull()
    await act(async () => {
      document.querySelector<HTMLButtonElement>(`[role="option"][data-target-kind="${mode === 'link' ? 'plan' : 'component'}"]`)?.click()
    })
    await act(async () => {
      findButton('替换引用').click()
      await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    })
    const components = usePlanStore.getState().document?.components
    expect(components).toHaveLength(1)
    expect(components?.[0]).toMatchObject({ id: 'existing-ref', remark: '**Keep remark**', payload: { mode, target_plan_id: TARGET_PLAN_ID } })
    if (mode === 'embed') expect((components?.[0].payload as PlanReferencePayload).target_component_id).toBe(TARGET_COMPONENT_ID)
    else expect((components?.[0].payload as PlanReferencePayload).target_component_id).toBeUndefined()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not replace a reference that changed while target validation was pending', async () => {
    const payload: PlanReferencePayload = { mode: 'link', target_plan_id: '99999999999999999999999999999999',
      target_path_snapshot: 'Missing', target_name_snapshot: 'Old label' }
    usePlanStore.setState({ document: { ...createSourceDocument(), components: [{ id: 'existing-ref', type: 'plan_reference', payload }] } })
    const pending = deferred<{ ok: true; data: typeof planTarget }>()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:search') return { ok: true, data: { targets: [planTarget] } }
      if (channel === 'plan-reference:commitTarget') return pending.promise
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderPicker({ componentId: 'existing-ref', payload })
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="option"]')?.click()
    })
    await act(async () => {
      findButton('替换引用').click()
      await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('plan-reference:commitTarget', expect.anything()))
    })
    const changed = { ...payload, target_name_snapshot: 'Concurrent edit' }
    await act(async () => {
      usePlanStore.setState({ document: { ...createSourceDocument(), components: [{ id: 'existing-ref', type: 'plan_reference', payload: changed }] } })
      pending.resolve({ ok: true, data: planTarget })
      await Promise.resolve()
    })
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('替换'))
    expect(usePlanStore.getState().document?.components[0].payload).toEqual(changed)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('替换')
  })
  it('searches only the active library and lists plan-only and component targets for links', async () => {
    await renderPicker()
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith('plan-reference:search', {
      library_id: LIBRARY_ID,
      query: ''
    }))

    expect(invokeMock.mock.calls[0]?.[1]).toEqual({ library_id: LIBRARY_ID, query: '' })
    expect(JSON.stringify(invokeMock.mock.calls[0]?.[1])).not.toContain('root')
    expect(document.querySelector('[role="option"][data-target-kind="plan"]')?.textContent).toContain('Target plan')
    expect(document.querySelector('[role="option"][data-target-kind="component"]')?.textContent).toContain('Weekly tasks')
  })

  it('filters plan-only targets out of embed mode and retains native component targets', async () => {
    await renderPicker()
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())

    await act(async () => { findButton('软链接').click() })

    expect(document.querySelector('[role="option"][data-target-kind="plan"]')).toBeNull()
    expect(document.querySelector('[role="option"][data-target-kind="component"]')?.textContent).toContain('Weekly tasks')
  })

  it('defaults the editable display name from the selected target and supports both relationship modes', async () => {
    await renderPicker()
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="option"][data-target-kind="component"]')?.click()
    })

    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="显示名称"]')
    expect(nameInput?.value).toBe('Weekly tasks')
    expect(findButton('普通关联').getAttribute('aria-pressed')).toBe('true')
    expect(findButton('软链接').disabled).toBe(false)

    await act(async () => { findButton('软链接').click() })
    expect(findButton('软链接').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector<HTMLInputElement>('input[aria-label="显示名称"]')?.value).toBe('Weekly tasks')
  })

  it('cancel closes without allocating a target identity or inserting a card', async () => {
    await renderPicker()
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())

    await act(async () => { findButton('取消').click() })

    expect(onClose).toHaveBeenCalledOnce()
    expect(invokeMock).not.toHaveBeenCalledWith('plan-reference:commitTarget', expect.anything())
    expect(usePlanStore.getState().document?.components).toHaveLength(0)
  })

  it('commits stable target identity before appending one local reference card', async () => {
    let componentCountWhenTargetCommitted = -1
    invokeMock.mockImplementation(async (channel: string, request: unknown) => {
      if (channel === 'plan-reference:search') return { ok: true, data: { targets: [planTarget, componentTarget] } }
      if (channel === 'plan-reference:commitTarget') {
        componentCountWhenTargetCommitted = usePlanStore.getState().document?.components.length ?? -1
        return { ok: true, data: { plan_id: TARGET_PLAN_ID, path: componentTarget.path, plan_name: componentTarget.plan_name, component_id: TARGET_COMPONENT_ID, component_type: 'task_list', component_name: 'Weekly tasks' } }
      }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderPicker()
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="option"][data-target-kind="component"]')?.click()
    })
    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="显示名称"]')
    expect(nameInput).not.toBeNull()
    await act(async () => {
      setInputValue(nameInput!, 'My snapshot')
      findButton('插入引用').click()
      await vi.waitFor(() => expect(usePlanStore.getState().document?.components).toHaveLength(1))
    })

    const committed = invokeMock.mock.calls.find(([channel]) => channel === 'plan-reference:commitTarget')
    expect(committed?.[1]).toEqual({
      library_id: LIBRARY_ID,
      path: componentTarget.path,
      component_id: TARGET_COMPONENT_ID,
      mode: 'link'
    })
    expect(componentCountWhenTargetCommitted).toBe(0)
    const reference = usePlanStore.getState().document?.components[0]
    expect(reference).toMatchObject({
      type: 'plan_reference',
      payload: {
        mode: 'link',
        target_plan_id: TARGET_PLAN_ID,
        target_component_id: TARGET_COMPONENT_ID,
        target_path_snapshot: componentTarget.path,
        target_name_snapshot: 'My snapshot'
      }
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('does not insert when a late search completes after the source plan changes', async () => {
    const search = deferred<{ ok: true; data: { targets: typeof componentTarget[] } }>()
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:search') return search.promise
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderPicker()
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledOnce())

    await act(async () => {
      usePlanStore.setState({ currentPath: 'Daily_Plan/Next', sessionRevision: source.sessionRevision + 1 })
      useWorkspaceTabsStore.setState({ active_path: 'Daily_Plan/Next' })
      search.resolve({ ok: true, data: { targets: [componentTarget] } })
      await Promise.resolve()
    })

    expect(onClose).toHaveBeenCalled()
    expect(document.querySelector('[role="option"]')).toBeNull()
    expect(invokeMock).not.toHaveBeenCalledWith('plan-reference:commitTarget', expect.anything())
    expect(usePlanStore.getState().document?.components).toHaveLength(0)
  })

  it('does not leave a local card when stable identity allocation fails', async () => {
    invokeMock.mockImplementation(async (channel: string) => {
      if (channel === 'plan-reference:search') return { ok: true, data: { targets: [componentTarget] } }
      if (channel === 'plan-reference:commitTarget') return { ok: false, code: 500, message: 'internal' }
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await renderPicker()
    await vi.waitFor(() => expect(document.querySelector('[role="option"]')).not.toBeNull())
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[role="option"][data-target-kind="component"]')?.click()
      findButton('插入引用').click()
      await Promise.resolve()
    })

    expect(usePlanStore.getState().document?.components).toHaveLength(0)
  })
})

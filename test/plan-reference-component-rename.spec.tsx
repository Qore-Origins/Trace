// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR } from '../src/shared/errors'
import type { Component, PlanDocument } from '../src/shared/plan-types'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { HeadingCard } from '../src/renderer/src/components/cards/HeadingCard'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const COMPONENT_ID = '22222222222222222222222222222222'
const LIBRARY_ID = '11111111111111111111111111111111'
const PATH = 'Target'
const oldComponent: Component = { id: COMPONENT_ID, type: 'heading', payload: { title: 'Old title', size: 18 } }

function plan(title = 'Old title', stamp = 'stamp-0'): PlanDocument {
  return {
    format_version: '1', plan_id: '33333333333333333333333333333333',
    created_at: '', updated_at: stamp,
    components: [{ id: COMPONENT_ID, type: 'heading', payload: { title, size: 18 } }]
  }
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let oldPlan: ReturnType<typeof usePlanStore.getState>
let oldTabs: ReturnType<typeof useWorkspaceTabsStore.getState>
let oldBridge: PropertyDescriptor | undefined

function renderCard(): React.JSX.Element {
  return createElement(DndContext, null,
    createElement(SortableContext, { items: [COMPONENT_ID], strategy: verticalListSortingStrategy },
      createElement(HeadingCard, { comp: oldComponent, index: 0, total: 1, today: new Date('2026-10-01') })))
}

async function typeTitle(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('input setter missing')
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  oldPlan = usePlanStore.getState()
  oldTabs = useWorkspaceTabsStore.getState()
  oldBridge = Object.getOwnPropertyDescriptor(window, 'trace')
  usePlanStore.getState().close()
  usePlanStore.setState({ currentPath: PATH, document: plan(), serverUpdatedAt: 'stamp-0', saveState: 'idle' })
  useWorkspaceTabsStore.setState({ library_id: LIBRARY_ID, rootKey: 'root', active_path: PATH,
    open_paths: [{ path: PATH }], restoreStatus: 'ready' })
  bindAntdHost({ confirm: vi.fn() } as never, { warning: vi.fn(), error: vi.fn() } as never)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root.render(renderCard()) })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  usePlanStore.getState().close()
  usePlanStore.setState(oldPlan)
  useWorkspaceTabsStore.setState(oldTabs)
  if (oldBridge) Object.defineProperty(window, 'trace', oldBridge)
  else Reflect.deleteProperty(window, 'trace')
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  vi.restoreAllMocks()
})

describe('reference-aware component title editing', () => {
  it('restores the committed title when the user cancels the inbound-reference confirmation', async () => {
    const confirm = vi.fn((options: { onCancel: () => void }) => {
      options.onCancel()
      return {} as never
    })
    bindAntdHost({ confirm } as never, { warning: vi.fn(), error: vi.fn() } as never)
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'rename-component', path: PATH, component_id: COMPONENT_ID,
          new_title: 'Cancelled title', expected_updated_at: 'stamp-0', target_updated_at: 'stamp-0',
          target_plan_ids: [], references: [{ source_path: 'Source', source_component_id: '44444444444444444444444444444444',
            source_updated_at: 'stamp-0', target_plan_id: plan().plan_id, target_component_id: COMPONENT_ID,
            mode: 'embed', target_path_snapshot: PATH, target_name_snapshot: 'Old title' }]
        } }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    const input = host.querySelector<HTMLInputElement>('input.heading-input')!
    await typeTitle(input, 'Cancelled title')
    await act(async () => { input.focus(); input.blur() })
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce())
    expect(input.value).toBe('Old title')
    expect(calls).toEqual(['plan-reference:previewImpact'])
    await act(async () => { input.focus(); input.blur() })
    expect(confirm).toHaveBeenCalledOnce()
  })

  it('keeps a title draft until blur and commits through typed impact preview', async () => {
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') {
          expect(request).toMatchObject({ operation: 'rename-component', path: PATH,
            component_id: COMPONENT_ID, new_title: 'New title', expected_updated_at: 'stamp-0' })
          return { ok: true, data: { operation: 'rename-component', path: PATH,
            component_id: COMPONENT_ID, new_title: 'New title', expected_updated_at: 'stamp-0',
            target_updated_at: 'stamp-0', target_plan_ids: [], references: [] } }
        }
        if (channel === 'plan-reference:commitImpact') return { ok: true, data: {} }
        if (channel === 'storage:readPlan') return { ok: true, data: plan('New title', 'stamp-1') }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    const input = host.querySelector<HTMLInputElement>('input.heading-input')!
    await typeTitle(input, 'New title')
    expect(input.value).toBe('New title')
    expect((usePlanStore.getState().document?.components[0].payload as { title: string }).title).toBe('Old title')
    expect(calls).toEqual([])
    await act(async () => { input.focus(); input.blur() })
    await vi.waitFor(() => expect(calls).toContain('plan-reference:commitImpact'))
    expect(calls).toEqual(['plan-reference:previewImpact', 'plan-reference:commitImpact', 'storage:readPlan'])
  })

  it('retains the draft after a CAS conflict so the user can retry', async () => {
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        if (channel === 'plan-reference:previewImpact') return {
          ok: false, code: ERR.CONFLICT, message: 'target changed', data: null
        }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    const input = host.querySelector<HTMLInputElement>('input.heading-input')!
    await typeTitle(input, 'Draft survives')
    await act(async () => { input.focus(); input.blur() })
    expect(input.value).toBe('Draft survives')
    expect((usePlanStore.getState().document?.components[0].payload as { title: string }).title).toBe('Old title')
  })
})

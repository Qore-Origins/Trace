// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { DndContext } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDocument } from '../src/shared/plan-types'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { HeadingCard } from '../src/renderer/src/components/cards/HeadingCard'
import { i18n } from '../src/renderer/src/i18n'
import { usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const COMPONENT_ID = '22222222222222222222222222222222'
const LIBRARY_ID = '11111111111111111111111111111111'
const PATH = 'Target'

function planDocument(withComponent = true): PlanDocument {
  return { format_version: '1', plan_id: '33333333333333333333333333333333',
    created_at: '', updated_at: withComponent ? 'stamp-0' : 'stamp-1',
    components: withComponent ? [{ id: COMPONENT_ID, type: 'heading', payload: { title: 'Heading', size: 18 } }] : [] }
}

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let oldPlan: ReturnType<typeof usePlanStore.getState>
let oldTabs: ReturnType<typeof useWorkspaceTabsStore.getState>
let oldBridge: PropertyDescriptor | undefined
let oldLanguage: string

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  oldPlan = usePlanStore.getState()
  oldTabs = useWorkspaceTabsStore.getState()
  oldBridge = Object.getOwnPropertyDescriptor(window, 'trace')
  oldLanguage = i18n.language
  await i18n.changeLanguage('zh-CN')
  usePlanStore.getState().close()
  usePlanStore.setState({ currentPath: PATH, document: planDocument(), serverUpdatedAt: 'stamp-0', saveState: 'idle' })
  useWorkspaceTabsStore.setState({ library_id: LIBRARY_ID, rootKey: 'root', active_path: PATH,
    open_paths: [{ path: PATH }], restoreStatus: 'ready' })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(DndContext, null,
      createElement(SortableContext, { items: [COMPONENT_ID], strategy: verticalListSortingStrategy },
        createElement(HeadingCard, { comp: planDocument().components[0], index: 0, total: 1, today: new Date('2026-10-01') }))))
  })
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  usePlanStore.getState().close()
  usePlanStore.setState(oldPlan)
  useWorkspaceTabsStore.setState(oldTabs)
  await i18n.changeLanguage(oldLanguage)
  if (oldBridge) Object.defineProperty(window, 'trace', oldBridge)
  else Reflect.deleteProperty(window, 'trace')
  Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  vi.restoreAllMocks()
})

function deleteButton(): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find((entry) => entry.getAttribute('aria-label') === i18n.t('cards.remove'))
  if (!button) throw new Error('delete button missing')
  return button
}

describe('CardShell reference-aware deletion', () => {
  it('previews and commits a component deletion after the ordinary confirmation', async () => {
    bindAntdHost({ confirm: vi.fn((options: { onOk: () => Promise<void> }) => {
      void options.onOk()
      return {} as never
    }) } as never, { warning: vi.fn(), error: vi.fn() } as never)
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'delete-component', path: PATH, component_id: COMPONENT_ID,
          expected_updated_at: 'stamp-0', target_updated_at: 'stamp-0',
          target_plan_ids: [], references: []
        } }
        if (channel === 'plan-reference:commitImpact') return { ok: true, data: {} }
        if (channel === 'storage:readPlan') return { ok: true, data: planDocument(false) }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    await act(async () => { deleteButton().click() })
    await vi.waitFor(() => expect(calls).toContain('plan-reference:commitImpact'))
    expect(calls).toEqual(['plan-reference:previewImpact', 'plan-reference:commitImpact', 'storage:readPlan'])
  })

  it('keeps the component when the incoming-reference dialog is cancelled', async () => {
    let confirmations = 0
    bindAntdHost({ confirm: vi.fn((options: { onOk?: () => Promise<void>; onCancel?: () => void }) => {
      confirmations += 1
      if (confirmations === 1) void options.onOk?.()
      else options.onCancel?.()
      return {} as never
    }) } as never, { warning: vi.fn(), error: vi.fn() } as never)
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'delete-component', path: PATH, component_id: COMPONENT_ID,
          expected_updated_at: 'stamp-0', target_updated_at: 'stamp-0', target_plan_ids: [],
          references: [{ source_path: 'Source', source_component_id: '44444444444444444444444444444444',
            source_updated_at: 'stamp-0', target_plan_id: planDocument().plan_id,
            target_component_id: COMPONENT_ID, mode: 'embed',
            target_path_snapshot: PATH, target_name_snapshot: 'Heading' }]
        } }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    await act(async () => { deleteButton().click() })
    await vi.waitFor(() => expect(confirmations).toBe(2))
    expect(calls).toEqual(['plan-reference:previewImpact'])
    expect(usePlanStore.getState().document?.components).toHaveLength(1)
  })
})

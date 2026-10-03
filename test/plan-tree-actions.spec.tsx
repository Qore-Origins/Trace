// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlanDocument } from '../src/shared/plan-types'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { subscribePlanEvents, usePlanStore } from '../src/renderer/src/stores/plan-store'
import { useTreeStore } from '../src/renderer/src/stores/tree-store'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const LIBRARY_ID = '11111111111111111111111111111111'
const SOURCE_PATH = 'Source'
const TARGET_PATH = 'Target'

function document(): PlanDocument {
  return {
    format_version: '1', created_at: '', updated_at: 'stamp-0',
    components: [{ id: '22222222222222222222222222222222', type: 'heading', payload: { title: 'Before', size: 18 } }]
  }
}

let oldPlan: ReturnType<typeof usePlanStore.getState>
let oldTree: ReturnType<typeof useTreeStore.getState>
let oldTabs: ReturnType<typeof useWorkspaceTabsStore.getState>
let oldBridge: PropertyDescriptor | undefined

beforeEach(() => {
  oldPlan = usePlanStore.getState()
  oldTree = useTreeStore.getState()
  oldTabs = useWorkspaceTabsStore.getState()
  oldBridge = Object.getOwnPropertyDescriptor(window, 'trace')
  usePlanStore.getState().close()
  usePlanStore.setState({ currentPath: SOURCE_PATH, document: document(), serverUpdatedAt: 'stamp-0', saveState: 'idle' })
  useTreeStore.setState({ childrenMap: {}, loaded: {}, expandedKeys: [], selectedPath: null, selectedKind: null })
  useWorkspaceTabsStore.setState({ library_id: LIBRARY_ID, rootKey: 'root', open_paths: [], active_path: null, restoreStatus: 'ready' })
  bindAntdHost({ confirm: vi.fn() } as never, { warning: vi.fn(), error: vi.fn() } as never)
})

afterEach(() => {
  usePlanStore.getState().close()
  usePlanStore.setState(oldPlan)
  useTreeStore.setState(oldTree)
  useWorkspaceTabsStore.setState(oldTabs)
  if (oldBridge) Object.defineProperty(window, 'trace', oldBridge)
  else Reflect.deleteProperty(window, 'trace')
  vi.restoreAllMocks()
})

describe('plan tree reference actions', () => {
  it('saves an edit made during the delete animation before closing the target plan', async () => {
    usePlanStore.setState({ currentPath: TARGET_PATH, document: document(), serverUpdatedAt: 'stamp-0' })
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'delete-plan', path: TARGET_PATH, target_plan_ids: [], references: []
        } }
        if (channel === 'storage:savePlan') {
          expect((request as { document: PlanDocument }).document.due_date).toBe('2026-10-02')
          return { ok: true, data: { updated_at: 'stamp-1' } }
        }
        if (channel === 'plan-reference:commitImpact') return { ok: true, data: {} }
        if (channel === 'workspace-tabs:set') return { ok: true, data: null }
        if (channel === 'storage:treeGetChildren') return { ok: true, data: [] }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    await useTreeStore.getState().removePlan(TARGET_PATH, async () => {
      usePlanStore.getState().setDueDate('2026-10-02')
    })
    expect(calls.indexOf('storage:savePlan')).toBeGreaterThan(calls.indexOf('plan-reference:previewImpact'))
    expect(calls.indexOf('storage:savePlan')).toBeLessThan(calls.indexOf('plan-reference:commitImpact'))
    expect(usePlanStore.getState().currentPath).toBeNull()
  })

  it('retains the edit session and aborts deletion if the post-animation save fails', async () => {
    usePlanStore.setState({ currentPath: TARGET_PATH, document: document(), serverUpdatedAt: 'stamp-0' })
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'delete-plan', path: TARGET_PATH, target_plan_ids: [], references: []
        } }
        if (channel === 'storage:savePlan') return { ok: false, code: 30, message: 'save failed', data: null }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    await useTreeStore.getState().removePlan(TARGET_PATH, async () => {
      usePlanStore.getState().setDueDate('2026-10-02')
    })
    expect(calls).toEqual(['plan-reference:previewImpact', 'storage:savePlan'])
    expect(usePlanStore.getState().currentPath).toBe(TARGET_PATH)
    expect(usePlanStore.getState().document?.due_date).toBe('2026-10-02')
  })

  it('flushes the active editor before previewing a plan rename and commits without a second dialog when no inbound references survive', async () => {
    const calls: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'storage:savePlan') return { ok: true, data: { updated_at: 'stamp-1' } }
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'rename-plan', path: TARGET_PATH, new_name: 'Renamed',
          target_plan_ids: [], references: []
        } }
        if (channel === 'plan-reference:commitImpact') return { ok: true, data: { path: 'Renamed' } }
        if (channel === 'storage:treeGetChildren') return { ok: true, data: [] }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    usePlanStore.getState().patchComponent('22222222222222222222222222222222', (component) => ({
      ...component, payload: { title: 'Unsaved input', size: 18 }
    }))
    await useTreeStore.getState().renamePlan(TARGET_PATH, 'Renamed')
    expect(calls.indexOf('storage:savePlan')).toBeLessThan(calls.indexOf('plan-reference:previewImpact'))
    expect(calls.indexOf('plan-reference:previewImpact')).toBeLessThan(calls.indexOf('plan-reference:commitImpact'))
  })

  it('does not commit a plan deletion when the reference impact choice is cancelled', async () => {
    const calls: string[] = []
    bindAntdHost({ confirm: vi.fn((options: { onCancel: () => void }) => {
      options.onCancel()
      return {} as never
    }) } as never, { warning: vi.fn(), error: vi.fn() } as never)
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string) => {
        calls.push(channel)
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'delete-plan', path: TARGET_PATH, target_plan_ids: [LIBRARY_ID],
          references: [{ source_path: SOURCE_PATH, source_component_id: '33333333333333333333333333333333',
            source_updated_at: 'stamp-0', target_plan_id: LIBRARY_ID, mode: 'link',
            target_path_snapshot: TARGET_PATH, target_name_snapshot: TARGET_PATH }]
        } }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn(() => () => undefined)
    } })
    await useTreeStore.getState().removePlan(TARGET_PATH)
    expect(calls).toEqual(['plan-reference:previewImpact'])
  })

  it('does not reload the old active path after a reference update event during rename', async () => {
    usePlanStore.setState({ currentPath: TARGET_PATH, document: document(), serverUpdatedAt: 'stamp-0' })
    useWorkspaceTabsStore.setState({ open_paths: [{ path: TARGET_PATH }], active_path: TARGET_PATH })
    const callbacks = new Map<string, (payload: { path: string }) => void>()
    const reads: string[] = []
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        if (channel === 'plan-reference:previewImpact') return { ok: true, data: {
          operation: 'rename-plan', path: TARGET_PATH, new_name: 'Renamed',
          target_updated_at: 'stamp-0', target_plan_ids: [], references: []
        } }
        if (channel === 'plan-reference:commitImpact') {
          callbacks.get('trace:plan-changed')?.({ path: TARGET_PATH })
          return { ok: true, data: { path: 'Renamed' } }
        }
        if (channel === 'storage:readPlan') {
          reads.push((request as { path: string }).path)
          return { ok: true, data: document() }
        }
        if (channel === 'workspace-tabs:set') return { ok: true, data: null }
        if (channel === 'storage:treeGetChildren') return { ok: true, data: [] }
        throw new Error(`Unexpected channel ${channel}`)
      }), on: vi.fn((event: string, callback: (payload: { path: string }) => void) => {
        callbacks.set(event, callback)
        return () => callbacks.delete(event)
      })
    } })
    const unsubscribe = subscribePlanEvents()
    try {
      await useTreeStore.getState().renamePlan(TARGET_PATH, 'Renamed')
      expect(reads).toEqual(['Renamed'])
      expect(usePlanStore.getState().currentPath).toBe('Renamed')
    } finally {
      unsubscribe()
    }
  })
})

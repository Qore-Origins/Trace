// planStore：当前计划文档 + 渲染即编辑（防抖保存 + CAS 冲突处理）
import { getMessage, getModal } from '../antd-host'
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'

import type { PlanDocument, Component } from '@shared/plan-types'
import { validateDueDate } from '@shared/validation'
import { ERR } from '@shared/errors'
import { i18n } from '../i18n'

export type SaveState = 'idle' | 'editing' | 'saved' | 'error'

const DEBOUNCE_MS = 500

interface PlanState {
  currentPath: string | null
  document: PlanDocument | null
  // 服务器端最新 updated_at（CAS 锚点）
  serverUpdatedAt: string
  saveState: SaveState
  lastError: string | null
  externalAlert: boolean // 计划库在应用外被修改（涉及当前计划时提示）
  open: (path: string) => Promise<void>
  close: () => void
  // 渲染即编辑入口：mutator 在文档副本上执行，自动调度防抖保存
  mutate: (mutator: (doc: PlanDocument) => void) => void
  // 高频卡片编辑入口：只替换目标组件链路，保持其余组件引用稳定
  patchComponent: (componentId: string, patch: (component: Component) => Component) => void
  // 计划截止日期：赋值 ''/undefined 时删键（同 mutate 防抖保存路径）
  setDueDate: (due?: string) => void
  flush: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let sessionRevision = 0
let editRevision = 0
let persistedRevision = 0

interface PendingOperation {
  revision: number
  apply: (document: PlanDocument) => PlanDocument
}

let pendingOperations: PendingOperation[] = []

function resetEditingSession(): number {
  sessionRevision += 1
  editRevision = 0
  persistedRevision = 0
  pendingOperations = []
  return sessionRevision
}

function patchDocumentComponent(
  document: PlanDocument,
  componentId: string,
  patch: (component: Component) => Component
): PlanDocument {
  const index = document.components.findIndex((component) => component.id === componentId)
  if (index === -1) return document
  const current = document.components[index]
  const draft = { ...current, payload: structuredClone(current.payload) } as Component
  const components = document.components.slice()
  components[index] = patch(draft)
  return { ...document, components }
}

export const usePlanStore = create<PlanState>()((set, get) => ({
  currentPath: null,
  document: null,
  serverUpdatedAt: '',
  saveState: 'idle',
  lastError: null,
  externalAlert: false,

  open: async (path) => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    const openingSession = resetEditingSession()
    set({ currentPath: path, document: null, saveState: 'idle', lastError: null, externalAlert: false })
    try {
      const doc = await invoke('storage:readPlan', { path })
      if (sessionRevision !== openingSession) return
      set({ currentPath: path, document: doc, serverUpdatedAt: doc.updated_at, saveState: 'idle', lastError: null, externalAlert: false })
    } catch (e) {
      if (sessionRevision !== openingSession) return
      getMessage().error(e instanceof ClientError ? e.message : i18n.t('errors.openPlanFailed'))
      set({ currentPath: path, document: null })
    }
  },

  close: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    resetEditingSession()
    set({ currentPath: null, document: null, saveState: 'idle', externalAlert: false })
  },

  mutate: (mutator) => {
    const { document, currentPath } = get()
    if (!document || !currentPath) return
    const apply = (source: PlanDocument): PlanDocument => {
      const draft = structuredClone(source) as PlanDocument
      mutator(draft)
      return draft
    }
    editRevision += 1
    pendingOperations.push({ revision: editRevision, apply })
    set({ document: apply(document), saveState: 'editing' })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void get().flush()
    }, DEBOUNCE_MS)
  },

  patchComponent: (componentId, patch) => {
    const { document, currentPath } = get()
    if (!document || !currentPath) return
    const componentIndex = document.components.findIndex((component) => component.id === componentId)
    if (componentIndex === -1) return
    const next = patchDocumentComponent(document, componentId, patch)
    const patchedComponent = structuredClone(next.components[componentIndex]) as Component
    const apply = (source: PlanDocument): PlanDocument => {
      const index = source.components.findIndex((component) => component.id === componentId)
      if (index === -1) return source
      const components = source.components.slice()
      components[index] = structuredClone(patchedComponent) as Component
      return { ...source, components }
    }
    editRevision += 1
    pendingOperations.push({ revision: editRevision, apply })
    set({ document: next, saveState: 'editing' })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void get().flush()
    }, DEBOUNCE_MS)
  },

  setDueDate: (due?: string) => {
    try {
      validateDueDate(due) // 合约守卫：undefined/''=清除通过；非法值抛 TraceError（UI 日期输入恒合法，为外部调用方兜底）
    } catch (e) {
      getMessage().error(e instanceof Error ? e.message : i18n.t('errors.saveFailed'))
      return
    }
    get().mutate((doc) => {
      if (due) {
        doc.due_date = due
      } else {
        delete doc.due_date // 清空=删键（旧文档兼容：undefined 即未设置）
      }
    })
  },

  flush: async () => {
    const { document, currentPath, serverUpdatedAt } = get()
    if (!document || !currentPath || editRevision <= persistedRevision || saving) return
    const flushingSession = sessionRevision
    const flushingRevision = editRevision
    let scheduleNext = false
    saving = true
    try {
      const r = await invoke('storage:savePlan', {
        path: currentPath,
        document,
        expected_updated_at: serverUpdatedAt
      })
      // IPC 往返期间计划被删除/关闭/切换：丢弃结果（防污染新状态）
      if (sessionRevision !== flushingSession || get().currentPath !== currentPath) return
      persistedRevision = flushingRevision
      pendingOperations = pendingOperations.filter((operation) => operation.revision > flushingRevision)
      scheduleNext = editRevision > flushingRevision
      set({ serverUpdatedAt: r.updated_at, saveState: scheduleNext ? 'editing' : 'saved', lastError: null })
    } catch (e) {
      // 同上：目标已不在（如被删除）属正常竞态，静默丢弃，不误报
      if (sessionRevision !== flushingSession || get().currentPath !== currentPath) return
      if (e instanceof ClientError && e.code === ERR.CONFLICT) {
        // CAS 冲突：以服务端新版本为基底重放尚未落盘的操作，避免覆盖外部改动或丢失本地输入。
        const fresh = await invoke('storage:readPlan', { path: currentPath })
        if (sessionRevision !== flushingSession || get().currentPath !== currentPath) return
        const rebased = pendingOperations.reduce((next, operation) => operation.apply(next), fresh)
        persistedRevision = 0
        scheduleNext = pendingOperations.length > 0
        set({ document: rebased, serverUpdatedAt: fresh.updated_at, saveState: scheduleNext ? 'editing' : 'idle' })
        getMessage().warning(i18n.t('errors.contentRefreshed'))
      } else {
        const msg = e instanceof ClientError ? e.message : i18n.t('errors.saveFailed')
        set({ saveState: 'error', lastError: msg })
        getMessage().error(msg)
        scheduleNext = editRevision > flushingRevision
      }
    } finally {
      saving = false
      const activeSessionChanged = sessionRevision !== flushingSession
      const activeSessionHasPendingEdits = editRevision > persistedRevision
      if ((scheduleNext || activeSessionChanged) && activeSessionHasPendingEdits) {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void get().flush(), DEBOUNCE_MS)
      }
    }
  }
}))

// 常用变更便捷方法（组件层调用）
export function usePlanMutations() {
  const mutate = usePlanStore((s) => s.mutate)
  const patchComponentState = usePlanStore((s) => s.patchComponent)
  return {
    appendComponent: (component: Component) =>
      mutate((doc) => {
        doc.components.push(component)
      }),
    removeComponent: (componentId: string) =>
      mutate((doc) => {
        doc.components = doc.components.filter((c) => c.id !== componentId)
      }),
    moveComponent: (componentId: string, targetIndex: number) =>
      mutate((doc) => {
        const idx = doc.components.findIndex((c) => c.id === componentId)
        if (idx === -1) return
        const [moved] = doc.components.splice(idx, 1)
        doc.components.splice(Math.max(0, Math.min(targetIndex, doc.components.length)), 0, moved)
      }),
    replaceComponent: (componentId: string, next: Component) =>
      mutate((doc) => {
        const idx = doc.components.findIndex((c) => c.id === componentId)
        if (idx !== -1) doc.components[idx] = next
      }),
    patchComponent: (componentId: string, patch: (payload: Component['payload']) => void) =>
      patchComponentState(componentId, (component) => {
        patch(component.payload)
        return component
      })
  }
}

// 事件订阅：保存状态回执 / 计划被外部或他处修改
export function subscribePlanEvents(): () => void {
  const off1 = onEvent('trace:save-status', (p) => {
    const s = usePlanStore.getState()
    if (s.currentPath === p.path && s.saveState === 'editing') {
      usePlanStore.setState({ saveState: 'saved' })
    }
  })
  const off2 = onEvent('trace:plan-changed', (p) => {
    const s = usePlanStore.getState()
    if (s.currentPath === p.path && s.saveState === 'idle') {
      // 非本端编辑引起的变更（如 IPC 直改）：静默重拉
      void s.open(p.path)
    }
  })
  const off3 = onEvent('trace:fs-external-change', () => {
    const s = usePlanStore.getState()
    if (s.currentPath) usePlanStore.setState({ externalAlert: true })
  })
  return () => {
    off1()
    off2()
    off3()
  }
}

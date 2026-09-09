// planStore：当前计划文档 + 渲染即编辑（防抖保存 + CAS 冲突处理）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message } from 'antd'
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
  // 计划截止日期：赋值 ''/undefined 时删键（同 mutate 防抖保存路径）
  setDueDate: (due?: string) => void
  flush: () => Promise<void>
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saving = false
let pendingMutate = false

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
    try {
      const doc = await invoke('storage:readPlan', { path })
      set({ currentPath: path, document: doc, serverUpdatedAt: doc.updated_at, saveState: 'idle', lastError: null, externalAlert: false })
    } catch (e) {
      message.error(e instanceof ClientError ? e.message : i18n.t('errors.openPlanFailed'))
      set({ currentPath: path, document: null })
    }
  },

  close: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    pendingMutate = false
    set({ currentPath: null, document: null, saveState: 'idle', externalAlert: false })
  },

  mutate: (mutator) => {
    const { document, currentPath } = get()
    if (!document || !currentPath) return
    // 结构化克隆副本上执行变更（保持不可变更新语义）
    const draft = structuredClone(document) as PlanDocument
    mutator(draft)
    set({ document: draft, saveState: 'editing' })
    pendingMutate = true
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void get().flush()
    }, DEBOUNCE_MS)
  },

  setDueDate: (due?: string) => {
    try {
      validateDueDate(due) // 合约守卫：undefined/''=清除通过；非法值抛 TraceError（UI 日期输入恒合法，为外部调用方兜底）
    } catch (e) {
      message.error(e instanceof Error ? e.message : i18n.t('errors.saveFailed'))
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
    if (!document || !currentPath || !pendingMutate || saving) return
    saving = true
    pendingMutate = false
    try {
      const r = await invoke('storage:savePlan', {
        path: currentPath,
        document,
        expected_updated_at: serverUpdatedAt
      })
      // IPC 往返期间计划被删除/关闭/切换：丢弃结果（防污染新状态）
      if (get().currentPath !== currentPath) return
      set({ serverUpdatedAt: r.updated_at, saveState: 'saved', lastError: null })
    } catch (e) {
      // 同上：目标已不在（如被删除）属正常竞态，静默丢弃，不误报
      if (get().currentPath !== currentPath) return
      if (e instanceof ClientError && e.code === ERR.CONFLICT) {
        // CAS 冲突：静默重拉（提示一次）
        const fresh = await invoke('storage:readPlan', { path: currentPath })
        if (get().currentPath !== currentPath) return
        set({ document: fresh, serverUpdatedAt: fresh.updated_at, saveState: 'idle' })
        message.warning(i18n.t('errors.contentRefreshed'))
      } else {
        const msg = e instanceof ClientError ? e.message : i18n.t('errors.saveFailed')
        set({ saveState: 'error', lastError: msg })
        message.error(msg)
      }
    } finally {
      saving = false
      // 保存期间又有编辑 → 继续排程
      if (pendingMutate) {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void get().flush(), DEBOUNCE_MS)
      }
    }
  }
}))

// 常用变更便捷方法（组件层调用）
export function usePlanMutations() {
  const mutate = usePlanStore((s) => s.mutate)
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
      mutate((doc) => {
        const c = doc.components.find((x) => x.id === componentId)
        if (c) patch(c.payload)
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

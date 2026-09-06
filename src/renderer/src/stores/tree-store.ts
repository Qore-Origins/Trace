// treeStore：计划树（懒加载 childrenMap / 展开 / 选中 / 结构操作）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message } from 'antd'
import { isSelfOrDescendant } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { usePlanStore } from './plan-store'

interface TreeState {
  childrenMap: Record<string, PlanTreeNode[]> // key=父路径（''=顶层）
  loaded: Record<string, boolean>
  expandedKeys: string[]
  selectedPath: string | null
  loadChildren: (parentPath: string) => Promise<void>
  select: (path: string | null) => void
  setExpanded: (keys: string[]) => void
  createPlan: (parentPath: string, name: string) => Promise<void>
  renamePlan: (path: string, newName: string) => Promise<void>
  removePlan: (path: string) => Promise<void>
  movePlan: (dragPath: string, targetParent: string, orderIndex: number) => Promise<void>
  refreshAll: () => Promise<void>
  exportPlan: (path: string) => Promise<string | null>
  importPlan: (targetParent: string) => Promise<string | null>
  importMarkdown: (targetParent: string) => Promise<string | null>
}

interface TransferReport {
  imported: Array<{ path: string; renamedFrom?: string }>
  plans: number
  components: number
  tasks: number
  notes: number
  skipped: string[]
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '')
}

function reportText(kind: string, r: TransferReport): string {
  const renamed = r.imported.filter((i) => i.renamedFrom).map((i) => `${i.renamedFrom} → ${i.path}`)
  return [
    `${kind}完成：${r.plans} 个计划 / ${r.tasks} 个任务 / ${r.notes} 条注释`,
    renamed.length ? `同名自动改名：${renamed.join('；')}` : '',
    r.skipped.length ? `跳过 ${r.skipped.length} 个无法识别的文件` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

async function refreshInto(
  set: (partial: Partial<TreeState>) => void,
  get: () => TreeState,
  parentPath: string
): Promise<void> {
  try {
    const nodes = await invoke('storage:treeGetChildren', { parent_path: parentPath })
    set({ childrenMap: { ...get().childrenMap, [parentPath]: nodes }, loaded: { ...get().loaded, [parentPath]: true } })
  } catch (e) {
    if (e instanceof ClientError && e.code === 10) {
      // 父被删：刷新其父链（简化：全量刷顶层）
      await get().refreshAll()
      return
    }
    throw e
  }
}

export const useTreeStore = create<TreeState>()((set, get) => ({
  childrenMap: {},
  loaded: {},
  expandedKeys: [],
  selectedPath: null,

  loadChildren: async (parentPath) => {
    await refreshInto(set, get, parentPath)
  },

  select: (path) => set({ selectedPath: path }),

  setExpanded: (keys) => set({ expandedKeys: keys }),

  createPlan: async (parentPath, name) => {
    await invoke('storage:createPlan', { parent_path: parentPath, name })
    if (parentPath !== '' && !get().expandedKeys.includes(parentPath)) {
      set({ expandedKeys: [...get().expandedKeys, parentPath] })
    }
    await refreshInto(set, get, parentPath)
  },

  renamePlan: async (path, newName) => {
    const r = await invoke('storage:renamePlan', { path, new_name: newName })
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    await refreshInto(set, get, parent)
    // 选中/展开键迁移到新路径
    const renameKey = (keys: string[]) => keys.map((k) => (k === path ? r.path : k))
    set({
      expandedKeys: renameKey(get().expandedKeys),
      selectedPath: get().selectedPath === path ? r.path : get().selectedPath
    })
  },

  removePlan: async (path) => {
    await invoke('storage:deletePlan', { path, confirmed: true })
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    await refreshInto(set, get, parent)
    if (get().selectedPath === path || get().selectedPath?.startsWith(path + '/')) {
      get().select(null)
      usePlanStore.getState().close()
    }
  },

  movePlan: async (dragPath, targetParent, orderIndex) => {
    if (isSelfOrDescendant(dragPath, targetParent)) {
      message.warning('不能移动到自身或子计划中')
      return
    }
    await invoke('storage:movePlan', { path: dragPath, target_parent_path: targetParent, order_index: orderIndex })
    const dragParent = dragPath.includes('/') ? dragPath.slice(0, dragPath.lastIndexOf('/')) : ''
    await refreshInto(set, get, dragParent)
    if (targetParent !== dragParent) await refreshInto(set, get, targetParent)
  },

  refreshAll: async () => {
    set({ childrenMap: {}, loaded: {} })
    await refreshInto(set, get, '')
  },

  exportPlan: async (path) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const picked = await invoke('app:pickSavePath', { defaultName: `${name}-${todayYmd()}.plan`, extensions: ['plan'] })
    if (!picked.filePath) return null
    const r = await invoke('transfer:exportPlan', { path, saveTo: picked.filePath })
    return `已导出 ${r.plans} 个计划 / ${r.components} 个组件 → ${r.savedTo}`
  },

  importPlan: async (targetParent) => {
    const picked = await invoke('app:pickFiles', { extensions: ['plan'] })
    if (picked.files.length === 0) return null
    const reports: TransferReport[] = []
    for (const f of picked.files) {
      reports.push(await invoke('transfer:importPlan', { target_parent_path: targetParent, filePath: f.path }))
    }
    await refreshInto(set, get, targetParent)
    return reportText('导入', reports.reduce((a, b) => ({
      imported: [...a.imported, ...b.imported],
      plans: a.plans + b.plans,
      components: a.components + b.components,
      tasks: a.tasks + b.tasks,
      notes: a.notes + b.notes,
      skipped: [...a.skipped, ...b.skipped]
    })))
  },

  importMarkdown: async (targetParent) => {
    const picked = await invoke('app:pickFiles', { extensions: ['md'] })
    if (picked.files.length === 0) return null
    const r = await invoke('transfer:importMarkdown', {
      target_parent_path: targetParent,
      paths: picked.files.map((f) => f.path)
    })
    await refreshInto(set, get, targetParent)
    return reportText('迁入', r)
  }
}))

// 事件订阅：结构变化与外部变更 → 刷新相关层
export function subscribeTreeEvents(): () => void {
  const off1 = onEvent('trace:plan-changed', (p) => {
    const parent = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/')) : ''
    void useTreeStore.getState().loadChildren(parent).catch(() => {})
  })
  const off2 = onEvent('trace:fs-external-change', () => {
    void useTreeStore.getState().refreshAll().catch(() => {})
  })
  return () => {
    off1()
    off2()
  }
}

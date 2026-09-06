// treeStore：计划树（懒加载 childrenMap / 展开 / 选中 / 结构操作）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message } from 'antd'
import { isSelfOrDescendant, parentRel } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { usePlanStore } from './plan-store'

interface TreeState {
  childrenMap: Record<string, PlanTreeNode[]> // key=父路径（''=顶层）
  loaded: Record<string, boolean>
  expandedKeys: string[]
  selectedPath: string | null
  selectedKind: 'plan' | 'folder' | null
  loadChildren: (parentPath: string) => Promise<void>
  select: (path: string | null, kind?: 'plan' | 'folder' | null) => void
  setExpanded: (keys: string[]) => void
  createPlan: (parentPath: string, name: string) => Promise<void>
  createFolder: (parentPath: string, name: string) => Promise<void>
  renamePlan: (path: string, newName: string) => Promise<void>
  removePlan: (path: string) => Promise<void>
  movePlan: (dragPath: string, targetParent: string, orderIndex: number) => Promise<void>
  expandTo: (path: string) => Promise<void>
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

// 结构变更后的完整刷新：刷新 P 的子列表 + P 自身所在层（父层）
// ——节点自身的 has_children/kind 存在于父层列表里，只刷子列表箭头不会出现（2026-09-06 用户反馈根因）
async function refreshAround(set: (partial: Partial<TreeState>) => void, get: () => TreeState, path: string): Promise<void> {
  const parent = parentRel(path)
  await refreshInto(set, get, parent)
  const grandparent = parentRel(parent)
  if (grandparent !== parent) await refreshInto(set, get, grandparent)
}

export const useTreeStore = create<TreeState>()((set, get) => ({
  childrenMap: {},
  loaded: {},
  expandedKeys: [],
  selectedPath: null,
  selectedKind: null,

  loadChildren: async (parentPath) => {
    await refreshInto(set, get, parentPath)
  },

  select: (path, kind = null) => set({ selectedPath: path, selectedKind: path ? (kind ?? 'plan') : null }),

  setExpanded: (keys) => set({ expandedKeys: keys }),

  createPlan: async (parentPath, name) => {
    const node = await invoke('storage:createPlan', { parent_path: parentPath, name })
    if (parentPath !== '' && !get().expandedKeys.includes(parentPath)) {
      set({ expandedKeys: [...get().expandedKeys, parentPath] })
    }
    await refreshAround(set, get, node.path)
  },

  createFolder: async (parentPath, name) => {
    const node = await invoke('storage:createFolder', { parent_path: parentPath, name })
    if (parentPath !== '' && !get().expandedKeys.includes(parentPath)) {
      set({ expandedKeys: [...get().expandedKeys, parentPath] })
    }
    await refreshAround(set, get, node.path)
  },

  renamePlan: async (path, newName) => {
    const r = await invoke('storage:renamePlan', { path, new_name: newName })
    await refreshAround(set, get, r.path)
    // 选中/展开键迁移到新路径
    const renameKey = (keys: string[]) => keys.map((k) => (k === path || k.startsWith(path + '/') ? r.path + k.slice(path.length) : k))
    set({
      expandedKeys: renameKey(get().expandedKeys),
      selectedPath: get().selectedPath === path ? r.path : get().selectedPath
    })
    // 当前打开的计划路径同步迁移并重开（否则后续保存指向旧路径 404）
    if (usePlanStore.getState().currentPath === path) {
      await usePlanStore.getState().open(r.path)
    }
  },

  removePlan: async (path) => {
    await invoke('storage:deletePlan', { path, confirmed: true })
    await refreshAround(set, get, path)
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
    const name = dragPath.slice(dragPath.lastIndexOf('/') + 1)
    await invoke('storage:movePlan', { path: dragPath, target_parent_path: targetParent, order_index: orderIndex })
    const newPath = targetParent === '' ? name : `${targetParent}/${name}`
    await refreshAround(set, get, newPath)
    await refreshAround(set, get, dragPath)
    // 选中/展开键迁移
    const migrate = (keys: string[]) => keys.map((k) => (k === dragPath || k.startsWith(dragPath + '/') ? newPath + k.slice(dragPath.length) : k))
    set({ expandedKeys: migrate(get().expandedKeys), selectedPath: migrate([get().selectedPath ?? ''])[0] || null })
    if (usePlanStore.getState().currentPath === dragPath) {
      await usePlanStore.getState().open(newPath)
    }
  },

  refreshAll: async () => {
    set({ childrenMap: {}, loaded: {} })
    await refreshInto(set, get, '')
  },

  // 展开到指定路径（回溯定位用）：逐层加载各祖先的子列表，并入展开键
  expandTo: async (path) => {
    const segs = path.split('/').filter(Boolean)
    const layers: string[] = [''] // 每层父路径：'' → 'a' → 'a/b' ...
    let cur = ''
    for (const seg of segs) {
      cur = cur === '' ? seg : `${cur}/${seg}`
      layers.push(cur)
    }
    for (const parent of layers.slice(0, -1)) {
      if (!get().loaded[parent]) await refreshInto(set, get, parent)
    }
    set({ expandedKeys: [...new Set([...get().expandedKeys, ...layers.slice(0, -1)])] })
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
    await refreshAround(set, get, targetParent === '' ? reports[0]?.imported[0]?.path ?? '' : targetParent)
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
    await refreshAround(set, get, r.imported[0]?.path ?? targetParent)
    return reportText('迁入', r)
  }
}))

// 事件订阅：结构变化与外部变更 → 刷新相关层（含祖父层，更新节点自身 has_children/kind 条目）
export function subscribeTreeEvents(): () => void {
  const off1 = onEvent('trace:plan-changed', (p) => {
    void useTreeStore.getState().loadChildren(parentRel(p.path)).catch(() => {})
    const gp = parentRel(parentRel(p.path))
    if (gp !== parentRel(p.path)) void useTreeStore.getState().loadChildren(gp).catch(() => {})
  })
  const off2 = onEvent('trace:fs-external-change', () => {
    void useTreeStore.getState().refreshAll().catch(() => {})
  })
  return () => {
    off1()
    off2()
  }
}

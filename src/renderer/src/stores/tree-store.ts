// treeStore：计划树（懒加载 childrenMap / 展开 / 选中 / 结构操作）
import { create } from 'zustand'
import { invoke, onEvent, ClientError } from '../ipc-client'
import { message } from 'antd'
import { isSelfOrDescendant, parentRel } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { i18n } from '../i18n'
import { optimisticMove } from '../components/tree-utils'
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
  movePlan: (dragPath: string, targetParent: string) => Promise<boolean>
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

function reportText(kind: 'import' | 'migrate', r: TransferReport): string {
  const renamed = r.imported.filter((i) => i.renamedFrom).map((i) => `${i.renamedFrom} → ${i.path}`)
  return [
    i18n.t(kind === 'import' ? 'transfer.importDone' : 'transfer.migrateDone', { plans: r.plans, tasks: r.tasks, notes: r.notes }),
    renamed.length ? i18n.t('transfer.renamed', { list: renamed.join('；') }) : '',
    r.skipped.length ? i18n.t('transfer.skipped', { count: r.skipped.length }) : ''
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
    // 先关闭被删子树内打开的计划：删除成功会 emit plan-changed(被删路径)，
    // 若 currentPath 仍指向它，订阅会静默重拉 open() → 读已删文件 → 误报「目标位置不存在」
    const plan = usePlanStore.getState()
    if (plan.currentPath && (plan.currentPath === path || plan.currentPath.startsWith(path + '/'))) {
      plan.close()
    }
    try {
      await invoke('storage:deletePlan', { path, confirmed: true })
    } catch (e) {
      // 删除失败必须提示（此前 onOk 静默吞错，文件被占用/已被外部删除时用户毫无反馈）
      message.error(e instanceof ClientError ? e.message : i18n.t('errors.deleteFailed'))
      return
    }
    // 清理被删子树残留状态：expandedKeys/childrenMap/loaded 中的旧键
    // （否则同名重建文件夹后，expandedKeys 残留导致其意外自动展开、childrenMap 残留脏数据）
    const under = (k: string): boolean => k === path || k.startsWith(path + '/')
    const childrenMap: TreeState['childrenMap'] = {}
    for (const [k, v] of Object.entries(get().childrenMap)) if (!under(k)) childrenMap[k] = v
    const loaded: TreeState['loaded'] = {}
    for (const [k, v] of Object.entries(get().loaded)) if (!under(k)) loaded[k] = v
    set({ expandedKeys: get().expandedKeys.filter((k) => !under(k)), childrenMap, loaded })
    await refreshAround(set, get, path)
    if (get().selectedPath === path || get().selectedPath?.startsWith(path + '/')) {
      get().select(null)
    }
  },

  movePlan: async (dragPath, targetParent) => {
    if (isSelfOrDescendant(dragPath, targetParent)) {
      message.warning('不能移动到自身或子计划中')
      return false
    }
    const name = dragPath.slice(dragPath.lastIndexOf('/') + 1)
    const newPath = targetParent === '' ? name : `${targetParent}/${name}`

    // 乐观更新（2026-09-07：松手弹回原位修复）：IPC 往返期间 dnd-kit 已复位 transform，
    // 本地先行换位（含子树键/选中/展开迁移）保证松手即落定；失败整体回滚
    // 插入位按文件名排序（2026-09-08 定稿），乐观位与权威刷新位一致
    const snap = {
      childrenMap: get().childrenMap,
      loaded: get().loaded,
      expandedKeys: get().expandedKeys,
      selectedPath: get().selectedPath
    }
    const opt = optimisticMove(snap.childrenMap, snap.loaded, dragPath, targetParent)
    if (opt) {
      const migrateKey = (k: string): string => (k === dragPath || k.startsWith(dragPath + '/') ? newPath + k.slice(dragPath.length) : k)
      set({
        childrenMap: opt.childrenMap,
        loaded: opt.loaded,
        expandedKeys: [...new Set([...snap.expandedKeys.map(migrateKey), targetParent])],
        selectedPath: snap.selectedPath ? migrateKey(snap.selectedPath) : null
      })
    }
    try {
      await invoke('storage:movePlan', { path: dragPath, target_parent_path: targetParent })
    } catch (e) {
      if (opt) {
        set({ childrenMap: snap.childrenMap, loaded: snap.loaded, expandedKeys: snap.expandedKeys, selectedPath: snap.selectedPath })
      }
      message.error(e instanceof ClientError ? e.message : i18n.t('tree.moveFailed'))
      return false
    }
    await refreshAround(set, get, newPath)
    await refreshAround(set, get, dragPath)
    // 选中/展开键迁移（乐观已迁移时为幂等空转；覆盖不可乐观的分支）
    const migrate = (keys: string[]) => keys.map((k) => (k === dragPath || k.startsWith(dragPath + '/') ? newPath + k.slice(dragPath.length) : k))
    set({ expandedKeys: migrate(get().expandedKeys), selectedPath: migrate([get().selectedPath ?? ''])[0] || null })
    if (usePlanStore.getState().currentPath === dragPath) {
      await usePlanStore.getState().open(newPath)
    }
    return true
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
    return reportText('import', reports.reduce((a, b) => ({
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
    return reportText('migrate', r)
  }
}))

// 事件订阅：结构变化与外部变更 → 刷新相关层（含祖父层，更新节点自身 has_children/kind 条目）
export function subscribeTreeEvents(): () => void {
  const off1 = onEvent('trace:plan-changed', (p) => {
    void useTreeStore.getState().loadChildren(parentRel(p.path)).catch(() => {})
    const gp = parentRel(parentRel(p.path))
    if (gp !== parentRel(p.path)) void useTreeStore.getState().loadChildren(gp).catch(() => {})
  })
  const off2 = onEvent('trace:fs-external-change', (p) => {
    // 定向刷新（VS Code 借鉴：变更只更新相关层，不整树重载——2026-09-10 用户反馈）
    // 应用自身操作的 chokidar 回声已在 main 侧抑制（PlanRepository 目录操作登记）；此处覆盖真外部变更
    const rel = p.paths[0]
    if (!rel) {
      void useTreeStore.getState().refreshAll().catch(() => {})
      return
    }
    void useTreeStore.getState().loadChildren(parentRel(rel)).catch(() => {})
    const gp = parentRel(parentRel(rel))
    if (gp !== parentRel(rel)) void useTreeStore.getState().loadChildren(gp).catch(() => {})
  })
  return () => {
    off1()
    off2()
  }
}

// 计划树纯逻辑（组件文件只导出组件，保证 React Fast Refresh 生效）
// 2026-09-08 拖拽语义定稿：树不做排序——三分区落点换算（intentOf/computeTreeMove/滞回）退役，
// 仅保留 flattenTree（可见扁平行）+ optimisticMove（松手即落位）；箭头数据驱动语义保持（U1 行为锚点）
import { parentRel } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'

// 可见扁平行（渲染单位；path='' 为根）
export interface FlatNode {
  path: string
  name: string
  kind: 'plan' | 'folder' | 'root'
  hasChildren: boolean
  depth: number // 根=0；顶层=1；缩进=depth×TREE_INDENT
  expanded: boolean
  loaded: boolean
}

// childrenMap/loaded/expandedKeys → 可见行（DFS 只走展开层）
// 箭头数据驱动：has_children=true → 箭头（未加载时展开即触发懒加载）；false → 无箭头占位
export function flattenTree(
  map: Record<string, PlanTreeNode[]>,
  loaded: Record<string, boolean>,
  expandedKeys: string[]
): FlatNode[] {
  const expanded = new Set(expandedKeys)
  const rows: FlatNode[] = []
  const rootChildren = map[''] ?? []
  rows.push({
    path: '',
    name: '计划库（源头）',
    kind: 'root',
    // 根箭头同样数据驱动：已加载且空 → 无箭头；未加载 → 保守显示
    hasChildren: loaded[''] === true ? rootChildren.length > 0 : true,
    depth: 0,
    expanded: expanded.has(''),
    loaded: loaded[''] === true
  })
  const walk = (parent: string, depth: number): void => {
    for (const nd of map[parent] ?? []) {
      const isOpen = expanded.has(nd.path)
      rows.push({
        path: nd.path,
        name: nd.name,
        kind: nd.kind,
        hasChildren: nd.has_children,
        depth,
        expanded: isOpen,
        loaded: loaded[nd.path] === true
      })
      if (isOpen && nd.has_children) walk(nd.path, depth + 1)
    }
  }
  walk('', 1)
  return rows
}

// 节点 kind 查询（folder=纯容器；默认 plan）
export function kindOf(map: Record<string, PlanTreeNode[]>, path: string): 'plan' | 'folder' {
  const parent = parentRel(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const hit = (map[parent] ?? []).find((n) => n.path === path || n.name === name)
  return hit?.kind ?? 'plan'
}

// ---------- 乐观移动（2026-09-07：松手弹回原位修复） ----------
// movePlan 为异步 IPC（fs 移动 + 双层刷新），无乐观更新时 dnd-kit 复位 transform 后
// childrenMap 仍是旧数据 → 行先弹回原位、IPC 回来再跳到新位。乐观先行换位消除该闪烁。

export interface TreeSnapshot {
  childrenMap: Record<string, PlanTreeNode[]>
  loaded: Record<string, boolean>
}

// name-sort 插入位（zh-CN，对齐主进程 treeGetChildren 文件夹排序）
function nameSortIndex(list: PlanTreeNode[], name: string): number {
  const i = list.findIndex((n) => n.name.localeCompare(name, 'zh-CN') > 0)
  return i === -1 ? list.length : i
}

// 乐观应用移动：dragPath → (targetParent, orderIndex)；返回迁移后快照，不可应用返回 null
// 插入位按父级顺序载体现实：顶层/计划父级=children_order 精确索引；纯文件夹=按名排序
// （乐观位与刷新后的权威位一致，避免二次跳位）
export function optimisticMove(
  map: Record<string, PlanTreeNode[]>,
  loaded: Record<string, boolean>,
  dragPath: string,
  targetParent: string,
  orderIndex: number
): TreeSnapshot | null {
  if (dragPath === '') return null
  const oldParent = parentRel(dragPath)
  const node = (map[oldParent] ?? []).find((x) => x.path === dragPath)
  if (!node) return null
  const name = node.name
  const newPath = targetParent === '' ? name : `${targetParent}/${name}`

  // 子树键/节点路径前缀迁移（已加载的后代层一并搬走；同父重排时 newPath===dragPath，迁移为恒等）
  const remapKey = (k: string): string =>
    k === dragPath || k.startsWith(dragPath + '/') ? newPath + k.slice(dragPath.length) : k
  const newMap: Record<string, PlanTreeNode[]> = {}
  for (const [k, arr] of Object.entries(map)) {
    newMap[remapKey(k)] = arr.map((x) => (x.path === dragPath || x.path.startsWith(dragPath + '/') ? { ...x, path: newPath + x.path.slice(dragPath.length) } : x))
  }
  const newLoaded: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(loaded)) newLoaded[remapKey(k)] = v

  // 从旧父层移除（迁移后节点 path 已是 newPath；同父时即剔除自身）
  const oldList = (newMap[oldParent] ?? []).filter((x) => x.path !== newPath)
  const tracksOrder = kindOf(map, targetParent) !== 'folder'
  if (targetParent === oldParent) {
    const idx = tracksOrder ? Math.max(0, Math.min(orderIndex, oldList.length)) : nameSortIndex(oldList, name)
    oldList.splice(idx, 0, { ...node, path: newPath })
    newMap[oldParent] = oldList
  } else {
    newMap[oldParent] = oldList
    if (newLoaded[targetParent] === true) {
      const list = [...newMap[targetParent]]
      const idx = tracksOrder ? Math.max(0, Math.min(orderIndex, list.length)) : nameSortIndex(list, name)
      list.splice(idx, 0, { ...node, path: newPath })
      newMap[targetParent] = list
      // 目标行 has_children 置真（空文件夹接收首子项：flattenTree 据此才下钻渲染，防乐观行不可见）
      const tp = parentRel(targetParent)
      if (newMap[tp]) newMap[tp] = newMap[tp].map((x) => (x.path === targetParent ? { ...x, has_children: true } : x))
    }
    // 目标层未加载 → 不预插（折叠中不可见；refreshAround 权威加载）
  }
  return { childrenMap: newMap, loaded: newLoaded }
}

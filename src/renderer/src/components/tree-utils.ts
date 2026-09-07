// 计划树纯逻辑（组件文件只导出组件，保证 React Fast Refresh 生效）
// 2026-09-07 antd Tree → dnd-kit 自渲染树：buildTreeData/computeDrop（antd 专用）退役，
// 改为 flattenTree（可见扁平行）+ 三分区落点换算；箭头数据驱动语义保持（U1 行为锚点）
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

// 拖拽意图（前插/入内部/后插）
export type DropIntent = 'before' | 'into' | 'after'

// 命中行内纵向偏移 → 意图
// [allowInto]=目标行是否接收「入内部」：文件夹/根=是（三分区）；计划=否（两分区——
// 计划不可被拖入内部，容器语义归文件夹，2026-09-07 用户反馈定稿）
export function intentOf(offsetY: number, height: number, allowInto: boolean): DropIntent {
  if (!allowInto) return offsetY < height / 2 ? 'before' : 'after'
  const third = height / 3
  if (offsetY < third) return 'before'
  if (offsetY > height - third) return 'after'
  return 'into'
}

// 意图滞回死区（px）：同目标行内，指针须深入新分区此距离才切换意图——
// 消除分区边界上的高频翻转（让位动画与入内高亮来回对切=视觉抽搐，2026-09-07 用户反馈）
export const HYST_PX = 4

// 滞回防抖：prev=同行的上一意图；指针未深入新分区 HYST_PX 则维持 prev
export function applyHysteresis(
  prev: { id: string; intent: DropIntent } | null,
  id: string,
  raw: DropIntent,
  offsetY: number,
  height: number,
  allowInto: boolean
): DropIntent {
  if (!prev || prev.id !== id || prev.intent === raw) return raw
  if (!allowInto) {
    const mid = height / 2
    if (prev.intent === 'before' && offsetY < mid + HYST_PX) return 'before'
    if (prev.intent === 'after' && offsetY > mid - HYST_PX) return 'after'
    return raw
  }
  const t1 = height / 3
  const t2 = height - t1
  if (prev.intent === 'before' && offsetY < t1 + HYST_PX) return 'before'
  if (prev.intent === 'after' && offsetY > t2 - HYST_PX) return 'after'
  if (prev.intent === 'into' && offsetY > t1 - HYST_PX && offsetY < t2 + HYST_PX) return 'into'
  return raw
}

// 意图 → movePlan 参数（dragPath, targetParent, orderIndex）
// 修正旧 computeDrop 的 0/1 简化：精确按目标在兄弟中的索引换算；兄弟列表先剔除源自身——
// 主进程 removeOrderEntry 在 insertOrderEntry 之前执行，索引须按移除后列表计
export function computeTreeMove(
  dragPath: string,
  target: FlatNode,
  intent: DropIntent,
  map: Record<string, PlanTreeNode[]>
): { dragPath: string; targetParent: string; orderIndex: number } | null {
  if (dragPath === '' || dragPath === target.path) return null
  // 根不是普通行：只接收「入内部」（= 移到顶层末尾）
  if (target.kind === 'root') {
    return intent === 'into' ? { dragPath, targetParent: '', orderIndex: Number.MAX_SAFE_INTEGER } : null
  }
  if (intent === 'into') {
    // 容器语义归文件夹：计划行不接收入内部（与 intentOf 两分区互为双保险）
    if (target.kind !== 'folder') return null
    return { dragPath, targetParent: target.path, orderIndex: Number.MAX_SAFE_INTEGER }
  }
  const parent = parentRel(target.path)
  const dragName = dragPath.slice(dragPath.lastIndexOf('/') + 1)
  const siblings = (map[parent] ?? []).map((n) => n.name).filter((nm) => nm !== dragName)
  const idx = siblings.indexOf(target.name)
  if (idx === -1) return { dragPath, targetParent: parent, orderIndex: siblings.length }
  return { dragPath, targetParent: parent, orderIndex: intent === 'before' ? idx : idx + 1 }
}

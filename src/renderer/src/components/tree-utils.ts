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

export const TREE_INDENT = 18 // 每级缩进 px（与 .tree-guides .guide 宽度一致）

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

// 拖拽意图（三分区：命中行上 1/3=前插，中 1/3=入内部，下 1/3=后插）
export type DropIntent = 'before' | 'into' | 'after'

// 命中行内纵向偏移 → 意图
export function intentOf(offsetY: number, height: number): DropIntent {
  const third = height / 3
  if (offsetY < third) return 'before'
  if (offsetY > height - third) return 'after'
  return 'into'
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
  if (intent === 'into') return { dragPath, targetParent: target.path, orderIndex: Number.MAX_SAFE_INTEGER }
  const parent = parentRel(target.path)
  const dragName = dragPath.slice(dragPath.lastIndexOf('/') + 1)
  const siblings = (map[parent] ?? []).map((n) => n.name).filter((nm) => nm !== dragName)
  const idx = siblings.indexOf(target.name)
  if (idx === -1) return { dragPath, targetParent: parent, orderIndex: siblings.length }
  return { dragPath, targetParent: parent, orderIndex: intent === 'before' ? idx : idx + 1 }
}

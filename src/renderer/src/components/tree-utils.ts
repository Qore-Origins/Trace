// 计划树纯逻辑（从 PlanTreePanel 拆出：组件文件只导出组件，保证 React Fast Refresh 生效）
import type { TreeProps } from 'antd'
import { parentRel } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'
import type { TreeDataNode } from 'antd'

// childrenMap → antd 树数据（懒加载：未加载层 children=undefined 触发 loadData）
export function buildTreeData(map: Record<string, PlanTreeNode[]>, loaded: Record<string, boolean>): TreeDataNode[] {
  const root: TreeDataNode = { key: '', title: '计划库（源头）', children: buildLevel('', map, loaded) }
  return [root]
}

function buildLevel(parent: string, map: Record<string, PlanTreeNode[]>, loaded: Record<string, boolean>): TreeDataNode[] | undefined {
  if (loaded[parent] === undefined) return undefined // 未加载 → loadData 接管
  const nodes = map[parent] ?? []
  return nodes.map((n) => ({
    key: n.path,
    title: n.name,
    children: buildLevel(n.path, map, loaded)
  }))
}

// 节点 kind 查询（folder=纯容器；默认 plan）
export function kindOf(map: Record<string, PlanTreeNode[]>, path: string): 'plan' | 'folder' {
  const parent = parentRel(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const hit = (map[parent] ?? []).find((n) => n.path === path || n.name === name)
  return hit?.kind ?? 'plan'
}

// antd onDrop → (dragPath, targetParent, orderIndex)
export function computeDrop(info: Parameters<NonNullable<TreeProps['onDrop']>>[0]): {
  dragPath: string
  targetParent: string
  orderIndex: number
} | null {
  const dragPath = String(info.dragNode.key)
  const dropKey = String(info.node.key)
  const dropPosArr = info.node.pos.split('-')
  const dropRelative = info.dropPosition - Number(dropPosArr[dropPosArr.length - 1])

  if (!info.dropToGap) {
    // 落入目标内部：target=该节点，插到其子级末尾
    return { dragPath, targetParent: dropKey, orderIndex: Number.MAX_SAFE_INTEGER }
  }
  // 落入间隙：与目标同级；relative -1=目标前，1=目标后
  const targetParent = parentRel(dropKey)
  return { dragPath, targetParent, orderIndex: dropRelative === -1 ? 0 : 1 }
}

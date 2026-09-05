// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、拖拽改道、悬停快捷操作
import { useEffect, useMemo } from 'react'
import { Tree, Dropdown, type TreeDataNode } from 'antd'
import type { TreeProps } from 'antd'
import { MoreOutlined, PlusOutlined } from '@ant-design/icons'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import { isSelfOrDescendant, parentRel } from '@shared/path-utils'
import type { PlanTreeNode } from '@shared/ipc-contract'

// childrenMap → antd 树数据（懒加载：未加载层 children=undefined 触发 loadData）
function buildTreeData(map: Record<string, PlanTreeNode[]>, loaded: Record<string, boolean>): TreeDataNode[] {
  const root: TreeDataNode = { key: '', title: renderRootTitle(), children: buildLevel('', map, loaded) }
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

function renderRootTitle(): React.JSX.Element {
  return (
    <span className="tree-root-label">
      <span className="origin-dot" />
      计划库（源头）
    </span>
  )
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
  const siblings = String(info.node.key).split('/')
  void siblings
  return { dragPath, targetParent, orderIndex: dropRelative === -1 ? 0 : 1 }
}

export default function PlanTreePanel(): React.JSX.Element {
  const { childrenMap, loaded, expandedKeys, selectedPath, loadChildren, select, setExpanded, createPlan, renamePlan, removePlan, movePlan } =
    useTreeStore()
  const openPlan = usePlanStore((s) => s.open)

  useEffect(() => {
    void loadChildren('')
  }, [loadChildren])

  const treeData = useMemo(() => buildTreeData(childrenMap, loaded), [childrenMap, loaded])

  const onDrop: TreeProps['onDrop'] = (info) => {
    const d = computeDrop(info)
    if (!d) return
    if (isSelfOrDescendant(d.dragPath, d.targetParent)) {
      // 循环嵌套：客户端先行拦截（视觉红显由 antd 插入线 + 此提示）
      void movePlan(d.dragPath, d.targetParent, d.orderIndex) // store 内再拦并提示
      return
    }
    void movePlan(d.dragPath, d.targetParent, d.orderIndex).then(() => {
      if (d.targetParent && !expandedKeys.includes(d.targetParent)) setExpanded([...expandedKeys, d.targetParent])
    })
  }

  const menuFor = (path: string): React.JSX.Element => (
    <Dropdown
      menu={{
        items: [
          {
            key: 'rename',
            label: '重命名',
            onClick: () => {
              const cur = path.slice(path.lastIndexOf('/') + 1)
              const name = window.prompt('重命名计划', cur)
              if (name && name !== cur) void renamePlan(path, name).catch(() => undefined)
            }
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => {
              // 删除确认（BR-007：二次确认 + 不可恢复提示）
              // eslint-disable-next-line no-alert
              const ok = window.confirm(`删除「${path.slice(path.lastIndexOf('/') + 1)}」？\n其全部子计划与内容将被删除，且不可恢复。`)
              if (ok) void removePlan(path).catch(() => undefined)
            }
          }
        ]
      }}
    >
      <button type="button" aria-label="更多操作">
        <MoreOutlined />
      </button>
    </Dropdown>
  )

  const titleRender = (node: TreeDataNode): React.JSX.Element => {
    const path = String(node.key)
    if (path === '') return renderRootTitle()
    const selected = selectedPath === path
    return (
      <span
        className="tree-node-title"
        style={selected ? { fontWeight: 500 } : undefined}
        onClick={() => {
          select(path)
          void openPlan(path)
        }}
      >
        <span className="name" style={selected ? { color: 'var(--trace-500)' } : undefined}>
          {node.title as string}
        </span>
        <span className="tree-quick">
          <button
            type="button"
            aria-label="新建子计划"
            onClick={(e) => {
              e.stopPropagation()
              const name = window.prompt('子计划名称')
              if (name) void createPlan(path, name).catch(() => undefined)
            }}
          >
            <PlusOutlined />
          </button>
          {menuFor(path)}
        </span>
      </span>
    )
  }

  return (
    <Tree
      treeData={treeData}
      showLine
      blockNode
      defaultExpandedKeys={['']}
      expandedKeys={expandedKeys}
      onExpand={(keys) => setExpanded(keys as string[])}
      loadData={async (node) => {
        if (node.key !== '') await loadChildren(String(node.key))
      }}
      titleRender={titleRender}
      draggable={(node) => String(node.key) !== ''}
      allowDrop={({ dropNode }) => true}
      onDrop={onDrop}
      selectedKeys={selectedPath ? [selectedPath] : []}
    />
  )
}

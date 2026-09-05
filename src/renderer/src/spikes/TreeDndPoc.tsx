import { useMemo } from 'react'
import { Tree, type TreeDataNode } from 'antd'

// SPIKE-2: antd Tree 内建拖拽 PoC——验证 API 面（跨层移动/插入线/循环校验钩子）
// 结论判定：类型检查通过 + onDrop/gap 语义符合 LLD §2.3.4 → 选 antd 内建；视觉手感 Sprint 2 dev 首验
// TODO(SPRINT-2): 接入 storage:treeGetChildren 真数据与 movePlan IPC；本组件仅 SPIKE 存档

interface PocNode extends TreeDataNode {
  key: string
  title: string
  children?: PocNode[]
}

const POC_DATA: PocNode[] = [
  {
    key: 'plan-2026a',
    title: '2026-A 学期',
    children: [
      { key: 'plan-web', title: 'Web 全栈实训' },
      {
        key: 'plan-trace',
        title: 'Trace 开发计划',
        children: [{ key: 'plan-weekly', title: '周计划' }]
      }
    ]
  },
  { key: 'plan-life', title: '生活计划' }
]

// 循环嵌套校验（LLD §6.2）：dropKey 不能位于 dragKey 自身/子孙链上
function isDescendantKey(tree: PocNode[], dragKey: string, dropKey: string): boolean {
  const parentMap = new Map<string, string>()
  const walk = (nodes: PocNode[], parent: string | null): void => {
    for (const n of nodes) {
      if (parent !== null) parentMap.set(n.key, parent)
      if (n.children) walk(n.children, n.key)
    }
  }
  walk(tree, null)
  let cur: string | undefined = dropKey
  while (cur !== undefined) {
    if (cur === dragKey) return true
    cur = parentMap.get(cur)
  }
  return false
}

export default function TreeDndPoc(): React.JSX.Element {
  const treeData = useMemo(() => POC_DATA, [])

  const handleDrop = (info: Parameters<NonNullable<React.ComponentProps<typeof Tree>['onDrop']>>[0]): void => {
    const dragKey = String(info.dragNode.key)
    const dropKey = String(info.node.key)
    const dropPos = info.node.pos.split('-')
    const dropParentKey = dropPos.length > 2 ? dropPos.slice(0, -1).join('-') : ''
    const dropGap = info.dropToGap // true=插入线（同层排序），false=落入目标内部（改父级）
    console.log('[TreeDndPoc]', { dragKey, dropKey, dropParentKey, dropGap })
    if (isDescendantKey(treeData, dragKey, dropKey) && !dropGap) {
      console.warn('[TreeDndPoc] 循环嵌套拒绝（UI 规范：红色插入线提示）')
    }
    // TODO(SPRINT-2): 调 window.trace.storage.movePlan / resortChildren
  }

  return (
    <Tree
      treeData={treeData}
      draggable={{ icon: false }}
      blockNode
      defaultExpandAll
      onDrop={handleDrop}
      allowDrop={({ dropNode, dropPosition }) => {
        // -1=目标节点上方插入线；其余位置允许（循环校验在 onDrop 内做最终判定）
        return dropNode !== undefined
      }}
    />
  )
}

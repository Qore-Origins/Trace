// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、拖拽改道、悬停快捷操作
// UI 整顿（2026-09-06）：创建入口收敛至此（树底虚线按钮）；弹窗一律 antd（禁原生 prompt/confirm）
// 纯逻辑在 tree-utils.ts（组件文件只导出组件，保证 Fast Refresh）；命名对话框挂载在 Workspace（ui-store 共用）
import { useEffect, useMemo } from 'react'
import { Tree, Dropdown, type TreeDataNode } from 'antd'
import type { TreeProps } from 'antd'
import { FolderAddOutlined, FolderOutlined, MoreOutlined, PlusOutlined, ReadOutlined } from '@ant-design/icons'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { isSelfOrDescendant } from '@shared/path-utils'
import { buildTreeData, computeDrop, kindOf } from './tree-utils'

function renderRootTitle(): React.JSX.Element {
  return (
    <span className="tree-root-label">
      <span className="origin-dot" />
      计划库（源头）
    </span>
  )
}

export default function PlanTreePanel(): React.JSX.Element {
  const { childrenMap, loaded, expandedKeys, selectedPath, loadChildren, select, setExpanded, createPlan, movePlan } = useTreeStore()
  const openPlan = usePlanStore((s) => s.open)
  const closePlan = usePlanStore((s) => s.close)
  const openNameDialog = useUiStore((s) => s.openNameDialog)

  useEffect(() => {
    void loadChildren('')
  }, [loadChildren])

  const treeData = useMemo(() => buildTreeData(childrenMap, loaded), [childrenMap, loaded])

  const onDrop: TreeProps['onDrop'] = (info) => {
    const d = computeDrop(info)
    if (!d) return
    if (isSelfOrDescendant(d.dragPath, d.targetParent)) {
      void movePlan(d.dragPath, d.targetParent, d.orderIndex) // store 内拦并提示
      return
    }
    void movePlan(d.dragPath, d.targetParent, d.orderIndex).then(() => {
      if (d.targetParent && !expandedKeys.includes(d.targetParent)) setExpanded([...expandedKeys, d.targetParent])
    })
  }

  const menuFor = (path: string, kind: 'plan' | 'folder'): React.JSX.Element => (
    <Dropdown
      menu={{
        items: [
          { key: 'create-plan', label: '新建子计划', onClick: () => openNameDialog({ mode: 'create-plan', targetPath: path, initialName: '' }) },
          { key: 'create-folder', label: '新建子文件夹', onClick: () => openNameDialog({ mode: 'create-folder', targetPath: path, initialName: '' }) },
          { type: 'divider' },
          { key: 'rename', label: '重命名', onClick: () => openNameDialog({ mode: 'rename', targetPath: path, initialName: path.slice(path.lastIndexOf('/') + 1) }) },
          { key: 'delete', label: '删除', danger: true, onClick: () => confirmRemoveTree(path, kind) }
        ]
      }}
    >
      <button type="button" className="lite-btn" aria-label="更多操作" onClick={(e) => e.stopPropagation()}>
        <MoreOutlined />
      </button>
    </Dropdown>
  )

  const titleRender = (node: TreeDataNode): React.JSX.Element => {
    const path = String(node.key)
    if (path === '') return renderRootTitle()
    const selected = selectedPath === path
    const kind = kindOf(childrenMap, path)
    return (
      <span
        className="tree-node-title"
        onClick={() => {
          if (kind === 'folder') {
            select(path, 'folder')
            closePlan()
          } else {
            select(path, 'plan')
            void openPlan(path)
          }
        }}
      >
        {kind === 'folder' ? (
          <FolderOutlined style={{ color: 'var(--text-4)', flex: 'none' }} aria-label="文件夹" />
        ) : (
          <ReadOutlined style={{ color: 'var(--trace-500)', opacity: 0.75, flex: 'none' }} aria-label="计划" />
        )}
        <span
          className="name"
          style={{
            ...(selected ? { color: 'var(--trace-500)', fontWeight: 500 } : kind === 'folder' ? { color: 'var(--text-2)' } : undefined)
          }}
        >
          {node.title as string}
        </span>
        <span className="tree-quick">
          <button
            type="button"
            className="lite-btn"
            aria-label="新建子计划"
            onClick={(e) => {
              e.stopPropagation()
              openNameDialog({ mode: 'create-plan', targetPath: path, initialName: '' })
            }}
          >
            <PlusOutlined />
          </button>
          <button
            type="button"
            className="lite-btn"
            aria-label="新建子文件夹"
            onClick={(e) => {
              e.stopPropagation()
              openNameDialog({ mode: 'create-folder', targetPath: path, initialName: '' })
            }}
          >
            <FolderAddOutlined />
          </button>
          {menuFor(path, kind)}
        </span>
      </span>
    )
  }

  return (
    <>
      <div className="tree-scroll">
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
      </div>
      <div className="tree-footer">
        <button type="button" className="dashed-btn" onClick={() => openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })}>
          <PlusOutlined /> 计划
        </button>
        <button type="button" className="dashed-btn" onClick={() => openNameDialog({ mode: 'create-folder', targetPath: '', initialName: '' })}>
          <FolderAddOutlined /> 文件夹
        </button>
      </div>
    </>
  )
}

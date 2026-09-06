// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、拖拽改道、悬停快捷操作
// UI 整顿（2026-09-06）：创建入口收敛至此（树底虚线按钮）；弹窗一律 antd（禁原生 prompt/confirm）
import { useEffect, useMemo, useState } from 'react'
import { Tree, Dropdown, Input, Modal, type TreeDataNode } from 'antd'
import type { TreeProps } from 'antd'
import { FolderAddOutlined, FolderOutlined, MoreOutlined, PlusOutlined, ReadOutlined } from '@ant-design/icons'
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

// 节点 kind 查询（folder=纯容器；默认 plan）
function kindOf(map: Record<string, PlanTreeNode[]>, path: string): 'plan' | 'folder' {
  const parent = parentRel(path)
  const name = path.slice(path.lastIndexOf('/') + 1)
  const hit = (map[parent] ?? []).find((n) => n.path === path || n.name === name)
  return hit?.kind ?? 'plan'
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
  return { dragPath, targetParent, orderIndex: dropRelative === -1 ? 0 : 1 }
}

// 命名对话框（新建计划/文件夹/重命名 共用一个受控 Modal）
interface NameDialog {
  mode: 'create-plan' | 'create-folder' | 'rename'
  targetPath: string // 新建=父路径；重命名=节点路径
  initialName: string
}

const DIALOG_TITLE: Record<NameDialog['mode'], string> = {
  'create-plan': '新建计划',
  'create-folder': '新建文件夹',
  rename: '重命名'
}

export default function PlanTreePanel(): React.JSX.Element {
  const { childrenMap, loaded, expandedKeys, selectedPath, loadChildren, select, setExpanded, createPlan, createFolder, renamePlan, removePlan, movePlan } =
    useTreeStore()
  const openPlan = usePlanStore((s) => s.open)
  const closePlan = usePlanStore((s) => s.close)
  const [dialog, setDialog] = useState<NameDialog | null>(null)
  const [inputValue, setInputValue] = useState('')

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

  const openDialog = (mode: NameDialog['mode'], targetPath: string, initialName = ''): void => {
    setDialog({ mode, targetPath, initialName })
    setInputValue(initialName)
  }

  const submitDialog = async (): Promise<void> => {
    if (!dialog || !inputValue.trim()) return
    const name = inputValue.trim()
    try {
      if (dialog.mode === 'create-plan') await createPlan(dialog.targetPath, name)
      else if (dialog.mode === 'create-folder') await createFolder(dialog.targetPath, name)
      else if (dialog.mode === 'rename') {
        if (name !== dialog.initialName) await renamePlan(dialog.targetPath, name)
      }
      setDialog(null)
    } catch {
      // 错误提示由 store/IPC 层弹出（重名等）；保持对话框开启供修改
    }
  }

  const confirmRemove = (path: string, kind: 'plan' | 'folder'): void => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    Modal.confirm({
      title: `删除${kind === 'folder' ? '文件夹' : '计划'}「${name}」？`,
      content: kind === 'folder' ? '其全部子计划与内容将被删除，且不可恢复。' : '该计划及其全部内容、子计划将被删除，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => removePlan(path).catch(() => undefined)
    })
  }

  const menuFor = (path: string, kind: 'plan' | 'folder'): React.JSX.Element => (
    <Dropdown
      menu={{
        items: [
          {
            key: 'create-plan',
            label: '新建子计划',
            onClick: () => openDialog('create-plan', path)
          },
          {
            key: 'create-folder',
            label: '新建子文件夹',
            onClick: () => openDialog('create-folder', path)
          },
          { type: 'divider' },
          {
            key: 'rename',
            label: '重命名',
            onClick: () => openDialog('rename', path, path.slice(path.lastIndexOf('/') + 1))
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            onClick: () => confirmRemove(path, kind)
          }
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
              openDialog('create-plan', path)
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
              openDialog('create-folder', path)
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
        <button
          type="button"
          className="dashed-btn"
          onClick={() => openDialog('create-plan', '')}
        >
          <PlusOutlined /> 计划
        </button>
        <button
          type="button"
          className="dashed-btn"
          onClick={() => openDialog('create-folder', '')}
        >
          <FolderAddOutlined /> 文件夹
        </button>
      </div>

      <Modal
        title={dialog ? DIALOG_TITLE[dialog.mode] : ''}
        open={dialog !== null}
        onOk={() => void submitDialog()}
        onCancel={() => setDialog(null)}
        okText={dialog?.mode === 'rename' ? '重命名' : '创建'}
        cancelText="取消"
        destroyOnClose
      >
        <Input
          placeholder={dialog?.mode === 'create-folder' ? '文件夹名称' : '计划名称'}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onPressEnter={() => void submitDialog()}
          autoFocus
        />
      </Modal>
    </>
  )
}

// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、悬停快捷操作
// 2026-09-08 拖拽语义定稿：树不做排序——拖到文件夹行=移入，拖到「计划库」根行=移到顶层；
// dnd-kit 浮起跟随（同款卡片手感），松手乐观落位（tree-store optimisticMove）
// 纯逻辑在 tree-utils.ts（组件文件只导出组件，保证 Fast Refresh）；命名对话框挂载在 Workspace
import { useEffect, useMemo, useState } from 'react'
import { Dropdown } from 'antd'
import {
  DownOutlined,
  FolderAddOutlined,
  FolderOutlined,
  HolderOutlined,
  LoadingOutlined,
  MoreOutlined,
  PlusOutlined,
  ReadOutlined,
  RightOutlined
} from '@ant-design/icons'
import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DraggableAttributes
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { isSelfOrDescendant, parentRel } from '@shared/path-utils'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { flattenTree, type FlatNode } from './tree-utils'

// 行内容（根/子行共享）：缩进连接线 + 手柄位 + 箭头 + 标题/快捷操作
function RowContent(props: {
  node: FlatNode
  selected: boolean
  handle: { attributes: DraggableAttributes; listeners: Record<string, unknown> | undefined } | null
  onToggle: (node: FlatNode) => void
  onOpen: (node: FlatNode) => void
}): React.JSX.Element {
  const { node, selected } = props
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const kind = node.kind
  if (kind === 'root') {
    // 根行：无快捷菜单（保持 antd 时代行为），仅展开/收起
    return (
      <>
        {node.hasChildren ? (
          <button type="button" className="tree-switcher" aria-label={node.expanded ? '折叠' : '展开'} onClick={() => props.onToggle(node)}>
            {node.expanded && !node.loaded ? <LoadingOutlined /> : node.expanded ? <DownOutlined /> : <RightOutlined />}
          </button>
        ) : (
          <span className="tree-switcher placeholder" />
        )}
        <span className="tree-root-label" onClick={() => props.onToggle(node)}>
          <span className="origin-dot" />
          计划库（源头）
        </span>
      </>
    )
  }

  return (
    <>
      {/* 缩进连接线（迹的骨架）：每级一条竖线 */}
      <span className="tree-guides" aria-hidden={true}>
        {Array.from({ length: node.depth }, (_, i) => (
          <span key={i} className="guide" />
        ))}
      </span>
      {props.handle && (
        <span className="drag-handle" aria-label="拖拽移动" title="拖动移入/移出文件夹" {...props.handle.attributes} {...props.handle.listeners}>
          <HolderOutlined />
        </span>
      )}
      {node.hasChildren ? (
        <button type="button" className="tree-switcher" aria-label={node.expanded ? '折叠' : '展开'} onClick={() => props.onToggle(node)}>
          {node.expanded && !node.loaded ? <LoadingOutlined /> : node.expanded ? <DownOutlined /> : <RightOutlined />}
        </button>
      ) : (
        <span className="tree-switcher placeholder" />
      )}
      <span className="tree-node-title" onClick={() => props.onOpen(node)}>
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
          {node.name}
        </span>
        <span className="tree-quick">
          <button
            type="button"
            className="lite-btn"
            aria-label="新建子计划"
            onClick={(e) => {
              e.stopPropagation()
              openNameDialog({ mode: 'create-plan', targetPath: node.path, initialName: '' })
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
              openNameDialog({ mode: 'create-folder', targetPath: node.path, initialName: '' })
            }}
          >
            <FolderAddOutlined />
          </button>
          <Dropdown
            menu={{
              items: [
                { key: 'create-plan', label: '新建子计划', onClick: () => openNameDialog({ mode: 'create-plan', targetPath: node.path, initialName: '' }) },
                { key: 'create-folder', label: '新建子文件夹', onClick: () => openNameDialog({ mode: 'create-folder', targetPath: node.path, initialName: '' }) },
                { type: 'divider' },
                { key: 'rename', label: '重命名', onClick: () => openNameDialog({ mode: 'rename', targetPath: node.path, initialName: node.name }) },
                { key: 'delete', label: '删除', danger: true, onClick: () => confirmRemoveTree(node.path, kind) }
              ]
            }}
          >
            <button type="button" className="lite-btn" aria-label="更多操作" onClick={(e) => e.stopPropagation()}>
              <MoreOutlined />
            </button>
          </Dropdown>
        </span>
      </span>
    </>
  )
}

interface RowProps {
  node: FlatNode
  selected: boolean
  onToggle: (node: FlatNode) => void
  onOpen: (node: FlatNode) => void
}

// 计划行：仅可拖（不接收放置——树不做排序，容器语义归文件夹/根）
function PlanRow(props: RowProps): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.node.path })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform) }}
      className={`tree-row${isDragging ? ' dragging' : ''}`}
      data-path={props.node.path}
    >
      <RowContent node={props.node} selected={props.selected} handle={{ attributes, listeners }} onToggle={props.onToggle} onOpen={props.onOpen} />
    </div>
  )
}

// 文件夹行：可拖 + 落点（移入）；无效目标（被拖项自身/子孙/现父）不高亮
function FolderRow(props: RowProps & { canReceive: boolean }): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: props.node.path })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: props.node.path })
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        setDropRef(el)
      }}
      style={{ transform: CSS.Transform.toString(transform) }}
      className={`tree-row${isDragging ? ' dragging' : ''}${isOver && props.canReceive ? ' drop-into' : ''}`}
      data-path={props.node.path}
    >
      <RowContent node={props.node} selected={props.selected} handle={{ attributes, listeners }} onToggle={props.onToggle} onOpen={props.onOpen} />
    </div>
  )
}

// 根行：不可拖，仅落点（接收「移到顶层」）
function RootTreeRow(props: { node: FlatNode; canReceive: boolean; onToggle: (node: FlatNode) => void }): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: '' })
  return (
    <div ref={setNodeRef} className={`tree-row root${isOver && props.canReceive ? ' drop-into' : ''}`} data-path="">
      <RowContent node={props.node} selected={false} handle={null} onToggle={props.onToggle} onOpen={props.onToggle} />
    </div>
  )
}

export default function PlanTreePanel(): React.JSX.Element {
  const { childrenMap, loaded, expandedKeys, selectedPath, loadChildren, select, setExpanded, movePlan } = useTreeStore()
  const openPlan = usePlanStore((s) => s.open)
  const closePlan = usePlanStore((s) => s.close)
  const openNameDialog = useUiStore((s) => s.openNameDialog)

  useEffect(() => {
    void loadChildren('')
  }, [loadChildren])

  const rows = useMemo(() => flattenTree(childrenMap, loaded, expandedKeys), [childrenMap, loaded, expandedKeys])

  // 被拖行 path（null=非拖拽中）：驱动根/文件夹行的「可接收」高亮判定
  const [activeId, setActiveId] = useState<string | null>(null)

  // 目标可接收判定：非被拖项自身/子孙（防循环嵌套）、非现父（已在其中=无意义移动）
  const canReceive = (dragPath: string, target: string): boolean =>
    dragPath !== target && !isSelfOrDescendant(dragPath, target) && parentRel(dragPath) !== target

  const onToggle = (node: FlatNode): void => {
    if (!node.hasChildren) return
    const isOpen = node.expanded
    setExpanded(isOpen ? expandedKeys.filter((k) => k !== node.path) : [...expandedKeys, node.path])
    if (!isOpen && !node.loaded) void loadChildren(node.path)
  }

  const onOpen = (node: FlatNode): void => {
    if (node.kind === 'folder') {
      select(node.path, 'folder')
      closePlan()
    } else {
      select(node.path, 'plan')
      void openPlan(node.path)
    }
  }

  // 碰撞：指针所在行命中；剔除被拖项自身（文件夹行自身也是落点，须排除）
  const treeCollision: CollisionDetection = (args) =>
    pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== args.active.id) })

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const dragPath = String(active.id)
    setActiveId(null)
    if (!over) return
    const target = String(over.id) // ''=根（移到顶层末尾）
    // 与高亮判定一致：无效目标静默忽略；store 内 guard 兜底提示
    if (!canReceive(dragPath, target)) return
    // movePlan 乐观更新（松手即落位）+ 失败回滚提示；成功后确保目标文件夹展开（读最新键，防闭包过期）
    void movePlan(dragPath, target).then((ok) => {
      if (!ok || target === '') return
      const cur = useTreeStore.getState().expandedKeys
      if (!cur.includes(target)) setExpanded([...cur, target])
    })
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const root = rows.find((r) => r.path === '')
  return (
    <>
      <div className={`tree-scroll${activeId ? ' is-dragging' : ''}`}>
        <DndContext
          sensors={sensors}
          collisionDetection={treeCollision}
          onDragStart={({ active }) => setActiveId(String(active.id))}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          {root && <RootTreeRow node={root} canReceive={activeId != null && canReceive(activeId, '')} onToggle={onToggle} />}
          {rows
            .filter((r) => r.path !== '')
            .map((r) =>
              r.kind === 'folder' ? (
                <FolderRow
                  key={r.path}
                  node={r}
                  selected={selectedPath === r.path}
                  canReceive={activeId != null && canReceive(activeId, r.path)}
                  onToggle={onToggle}
                  onOpen={onOpen}
                />
              ) : (
                <PlanRow key={r.path} node={r} selected={selectedPath === r.path} onToggle={onToggle} onOpen={onOpen} />
              )
            )}
        </DndContext>
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

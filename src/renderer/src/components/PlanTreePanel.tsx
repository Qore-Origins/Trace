// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、拖拽改道、悬停快捷操作
// 2026-09-07：antd Tree → dnd-kit 自渲染扁平树（同款 AI Resource Hub）：手柄拖拽、
// 让位动画、被拖行浮起、三分区落点（上/下 1/3=前/后插，中 1/3=入内部高亮）
// 纯逻辑在 tree-utils.ts（组件文件只导出组件，保证 Fast Refresh）；命名对话框挂载在 Workspace
import { useEffect, useMemo, useRef, useState } from 'react'
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
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DraggableAttributes
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { isSelfOrDescendant } from '@shared/path-utils'
import { TREE_INDENT, computeTreeMove, flattenTree, intentOf, type DropIntent, type FlatNode } from './tree-utils'

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
        <span className="drag-handle" aria-label="拖拽移动" title="拖动移动计划/文件夹" {...props.handle.attributes} {...props.handle.listeners}>
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

// 子行：sortable（手柄发起拖拽；行身=放置目标）
function SortableTreeRow(props: {
  node: FlatNode
  selected: boolean
  dropInto: boolean
  onToggle: (node: FlatNode) => void
  onOpen: (node: FlatNode) => void
}): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.node.path })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`tree-row${isDragging ? ' dragging' : ''}${props.dropInto ? ' drop-into' : ''}`}
      data-path={props.node.path}
    >
      <RowContent node={props.node} selected={props.selected} handle={{ attributes, listeners }} onToggle={props.onToggle} onOpen={props.onOpen} />
    </div>
  )
}

// 根行：不可拖，仅放置目标（接收「移到顶层末尾」）
function RootTreeRow(props: { node: FlatNode; dropInto: boolean; onToggle: (node: FlatNode) => void }): React.JSX.Element {
  const { setNodeRef } = useDroppable({ id: '' })
  return (
    <div ref={setNodeRef} className={`tree-row root${props.dropInto ? ' drop-into' : ''}`} data-path="">
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

  // 碰撞检测产出（ref 外置，onDragOver/onDragEnd 读取）
  const intentRef = useRef<DropIntent | null>(null)
  const intoIdRef = useRef<string | null>(null)
  const [dropInto, setDropInto] = useState<string | null>(null)

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

  // 自定义碰撞：指针 y 命中行 → 三分区定意图；「入内部」不返回 over（无让位——避免
  // 「插到这里」的误导），改由 dropInto 高亮目标行；键盘传感器退化为 closestCenter
  const treeCollision: CollisionDetection = (args) => {
    const y = args.pointerCoordinates?.y
    if (y === undefined) {
      intentRef.current = 'after'
      intoIdRef.current = null
      return closestCenter(args)
    }
    for (const container of args.droppableContainers) {
      const rect = args.droppableRects.get(container.id)
      if (!rect || y < rect.top || y > rect.bottom) continue
      const id = String(container.id)
      if (id === '') {
        intentRef.current = 'into'
        intoIdRef.current = ''
        return [{ id }] // 根=droppable（非 sortable）→ 无让位，仅高亮
      }
      const intent = intentOf(y - rect.top, rect.height)
      intentRef.current = intent
      if (intent === 'into') {
        intoIdRef.current = id
        return []
      }
      intoIdRef.current = null
      return [{ id }]
    }
    intentRef.current = null
    intoIdRef.current = null
    return []
  }

  const onDragOver = ({ active }: DragOverEvent): void => {
    // 入内部意图 → 高亮目标行（根/子行通用）；变化才 setState 防抖
    const want = intentRef.current === 'into' && intoIdRef.current !== String(active.id) ? intoIdRef.current : null
    setDropInto((cur) => (cur === want ? cur : want))
  }

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const dragPath = String(active.id)
    const intent = intentRef.current
    const intoId = intoIdRef.current
    intentRef.current = null
    intoIdRef.current = null
    setDropInto(null)

    // 入内部 → intoIdRef；前/后插 → over
    const targetPath = intent === 'into' ? intoId : over ? String(over.id) : null
    if (!targetPath) return
    const target = rows.find((r) => r.path === targetPath)
    if (!target) return
    const d = computeTreeMove(dragPath, target, intent ?? 'after', childrenMap)
    if (!d) return
    if (isSelfOrDescendant(d.dragPath, d.targetParent)) {
      void movePlan(d.dragPath, d.targetParent, d.orderIndex) // store 内拦并提示
      return
    }
    void movePlan(d.dragPath, d.targetParent, d.orderIndex).then(() => {
      if (d.targetParent && !expandedKeys.includes(d.targetParent)) setExpanded([...expandedKeys, d.targetParent])
    })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const root = rows.find((r) => r.path === '')
  return (
    <>
      <div className="tree-scroll">
        <DndContext sensors={sensors} collisionDetection={treeCollision} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <SortableContext items={rows.filter((r) => r.path !== '').map((r) => r.path)} strategy={verticalListSortingStrategy}>
            {root && <RootTreeRow node={root} dropInto={dropInto === ''} onToggle={onToggle} />}
            {rows
              .filter((r) => r.path !== '')
              .map((r) => (
                <SortableTreeRow key={r.path} node={r} selected={selectedPath === r.path} dropInto={dropInto === r.path} onToggle={onToggle} onOpen={onOpen} />
              ))}
          </SortableContext>
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

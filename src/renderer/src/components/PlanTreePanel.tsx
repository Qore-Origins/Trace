// PlanTreePanel（§3.1）：连接线可见、源头圆点、懒加载、悬停快捷操作
// 2026-09-08 拖拽语义定稿：树不做排序——拖到文件夹行=移入，拖到「计划库」根行=移到顶层（dnd-kit 浮起 + 乐观落位）
// 2026-09-08 卡牌摞动效（D1-D8，demo: docs/prototype/tree-animation-demo.html 定稿移植）：
//   递归 TreeGroup + 行槽（.slot grid 0fr↔1fr）渲染；展开=发牌入场（方向=用户偏好），收拢=延迟卸载+可取消；
//   折叠按钮=方框 +/- 旋转变号（D4）；父行脉冲（D5）；连接线生长（D6）；持牌暗示（D7）；大文件夹节奏压缩（D8）
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from 'antd'
import {
  FolderAddOutlined,
  FolderOutlined,
  HolderOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReadOutlined
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
import type { PlanTreeNode } from '@shared/ipc-contract'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { usePrefStore } from '../stores/pref-store'
import { useTranslation } from '../i18n'
import { effStagger } from './tree-utils'

// 行视图（渲染单位；path='' 为根）
interface RowView {
  path: string
  name: string
  kind: 'plan' | 'folder' | 'root'
  hasChildren: boolean
  depth: number
  expanded: boolean
  loaded: boolean
}

// 树交互上下文（Panel 注入，避免逐层 prop 钻透）
interface TreeUiCtxValue {
  onToggle: (node: RowView) => void
  onOpen: (node: RowView) => void
  activeId: string | null // 拖拽中的行 path
  canReceive: (dragPath: string, target: string) => boolean
  selectedPath: string | null
  removeWithAnimation: (path: string) => void // 删除先播收拢波次再真删（面板持有 closingPaths 态）
}
const TreeUiCtx = createContext<TreeUiCtxValue>({
  onToggle: () => undefined,
  onOpen: () => undefined,
  activeId: null,
  canReceive: () => false,
  selectedPath: null,
  removeWithAnimation: () => undefined
})

// 收拢波次表：父组收拢时「全部揭示行槽 path → 出场延迟(ms)」；null=非收拢子树
const ClosingDelaysCtx = createContext<Map<string, number> | null>(null)

// 收拢中路径集合（子组存续判定：展开中或收拢中都渲染）
const ClosingPathsCtx = createContext<Set<string>>(new Set())

// 删除中路径集合（独立于折叠 closingPaths——被删行自身收拢消失，不弹回）
const RemovingPathsCtx = createContext<Set<string>>(new Set())

// 读 CSS 时序 token（--t-gather: 260ms → 260）
function tokenMs(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(v) && v > 0 ? v : fallback
}

// 收拢揭示槽 DFS 序（父组收拢时给全部后代行槽排出场波次；含展开中的嵌套层）
function collectRevealedSlots(
  parentPath: string,
  childrenMap: Record<string, PlanTreeNode[]>,
  expandedKeys: string[],
  closingPaths: Set<string>
): string[] {
  const out: string[] = []
  const walk = (p: string): void => {
    for (const c of childrenMap[p] ?? []) {
      out.push(c.path)
      if (expandedKeys.includes(c.path) || closingPaths.has(c.path)) walk(c.path)
    }
  }
  walk(parentPath)
  return out
}

// ---------- 行内容（根/子行共享）：缩进连接线 + 手柄位 + 方框 +/- + 标题/快捷操作 ----------
// 容器能力：仅文件夹/库根可承载子项——「新建计划/文件夹」仅在此类节点出现
// （BR-005 计划/文件夹语义区分对操作矩阵的落实；用户反馈：计划上不该有新建子项钮）
function canHostChildren(kind: RowView['kind']): boolean {
  return kind === 'folder' || kind === 'root'
}

function RowContent(props: {
  node: RowView
  selected: boolean
  handle: { attributes: DraggableAttributes; listeners: Record<string, unknown> | undefined } | null
}): React.JSX.Element {
  const { node, selected } = props
  const { t } = useTranslation()
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const { onToggle, onOpen } = useContext(TreeUiCtx)
  const kind = node.kind
  const loading = node.expanded && !node.loaded // 懒加载中：方框位暂代旋转指示
  // 日记根：库根下第一层的 Diary 文件夹——仅显示层换名+蓝标（Task 5）；磁盘名恒为 Diary，绝不改名
  const isDiaryRoot = kind === 'folder' && node.name === 'Diary' && node.depth === 1
  if (kind === 'root') {
    // 根行：无快捷菜单（历史行为），仅展开/收拢
    return (
      <>
        {node.hasChildren ? (
          <button
            type="button"
            className={`tree-switcher${node.expanded ? ' open' : ''}`}
            aria-label={node.expanded ? t('tree.collapse') : t('tree.expand')}
            onClick={() => onToggle(node)}
          >
            {loading ? <LoadingOutlined /> : <PmBox />}
          </button>
        ) : (
          <span className="tree-switcher placeholder" />
        )}
        <span className="tree-root-label" onClick={() => onToggle(node)}>
          <span className="origin-dot" />
          {t('tree.rootLabel')}
        </span>
      </>
    )
  }

  return (
    <>
      {/* 缩进连接线（迹的骨架）：每级一条竖线（D6 随行生长） */}
      <span className="tree-guides" aria-hidden={true}>
        {Array.from({ length: node.depth }, (_, i) => (
          <span key={i} className="guide" />
        ))}
      </span>
      {props.handle && (
        <span
          className="drag-handle"
          aria-label={t('tree.dragMove')}
          title={t('tree.dragMoveTitle')}
          {...props.handle.attributes}
          {...props.handle.listeners}
        >
          <HolderOutlined />
        </span>
      )}
      {node.hasChildren ? (
        <button
          type="button"
          className={`tree-switcher${node.expanded ? ' open' : ''}`}
          aria-label={node.expanded ? t('tree.collapse') : t('tree.expand')}
          onClick={() => onToggle(node)}
        >
          {loading ? <LoadingOutlined /> : <PmBox />}
        </button>
      ) : (
        <span className="tree-switcher placeholder" />
      )}
      <span className="tree-node-title" onClick={() => onOpen(node)}>
        {kind === 'folder' ? (
          <FolderOutlined className="node-icon" aria-label={t('common.folder')} />
        ) : (
          <ReadOutlined className="node-icon plan" aria-label={t('common.plan')} />
        )}
        {isDiaryRoot && <span className="diary-dot" aria-hidden="true" />}
        <span
          className="name"
          style={{
            ...(selected ? { color: 'var(--trace-500)', fontWeight: 500 } : kind === 'folder' ? { color: 'var(--text-2)' } : undefined)
          }}
        >
          {isDiaryRoot ? t('diary.name') : node.name}
        </span>
        {canHostChildren(kind) && (
          <span className="tree-quick">
            <button
              type="button"
              className="lite-btn"
              aria-label={t('tree.newChildPlan')}
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
              aria-label={t('tree.newChildFolder')}
              onClick={(e) => {
                e.stopPropagation()
                openNameDialog({ mode: 'create-folder', targetPath: node.path, initialName: '' })
              }}
            >
              <FolderAddOutlined />
            </button>
          </span>
        )}
      </span>
    </>
  )
}

// D4 折叠按钮本体：方框 +/-（点击旋转 180°，旋转途中竖杠消长变号）
function PmBox(): React.JSX.Element {
  return (
    <span className="pm-box">
      <span className="pm-sign">
        <span className="pm-bar pm-h" />
        <span className="pm-bar pm-v" />
      </span>
    </span>
  )
}

// ---------- 行（计划=仅拖；文件夹=拖+落点；根=仅落点）+ D5 父行脉冲 ----------
// 2026-09-08：⋯ 悬停按钮退役——与收拢文件夹的 D7 牌边图标（right:10px）重叠；
// 操作菜单改为右键整行呼出（桌面惯例），快捷新建 + / 文件夹按钮保留
function TreeRow(props: { node: RowView }): React.JSX.Element {
  const { node } = props
  const { activeId, canReceive, selectedPath, removeWithAnimation } = useContext(TreeUiCtx)
  const { t } = useTranslation()
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: node.path,
    disabled: node.kind === 'root'
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: node.path, disabled: node.kind === 'plan' })

  // D5 父行脉冲：展开/收拢瞬间一闪（父行稳定挂载于其父组，展开状态翻转即触发）
  const [pulse, setPulse] = useState<'dealt' | 'gathered' | null>(null)
  const prevExpanded = useRef(node.expanded)
  useEffect(() => {
    if (prevExpanded.current === node.expanded) return
    prevExpanded.current = node.expanded
    setPulse(node.expanded ? 'dealt' : 'gathered')
    const t = setTimeout(() => setPulse(null), node.expanded ? 520 : 420)
    return () => clearTimeout(t)
  }, [node.expanded])

  const hasDeck = node.kind === 'folder' && node.hasChildren && !node.expanded // D7 持牌暗示
  const receivable = isOver && activeId != null && canReceive(activeId, node.path)
  const row = (
    <div
      ref={(el) => {
        setDragRef(el)
        setDropRef(el)
      }}
      style={{ transform: CSS.Transform.toString(transform) }}
      className={`tree-row${node.kind === 'root' ? ' root' : ''}${isDragging ? ' dragging' : ''}${
        receivable ? ' drop-into' : ''
      }${hasDeck ? ' has-deck' : ''}${pulse ? ` ${pulse}` : ''}`}
      data-path={node.path}
    >
      <RowContent node={node} selected={selectedPath === node.path} handle={node.kind === 'root' ? null : { attributes, listeners }} />
    </div>
  )
  if (node.kind === 'root') return row
  const kind = node.kind // 闭包内保留收窄（confirmRemoveTree 仅收 plan/folder）
  return (
    <Dropdown
      trigger={['contextMenu']}
      menu={{
        items: [
          // 新建子项仅容器节点（文件夹/库根）；计划没有子项语义
          ...(canHostChildren(kind)
            ? [
                { key: 'create-plan', label: t('tree.newChildPlan'), onClick: () => openNameDialog({ mode: 'create-plan', targetPath: node.path, initialName: '' }) },
                { key: 'create-folder', label: t('tree.newChildFolder'), onClick: () => openNameDialog({ mode: 'create-folder', targetPath: node.path, initialName: '' }) },
                { type: 'divider' as const }
              ]
            : []),
          { key: 'rename', label: t('common.rename'), onClick: () => openNameDialog({ mode: 'rename', targetPath: node.path, initialName: node.name }) },
          { key: 'delete', label: t('common.delete'), danger: true, onClick: () => confirmRemoveTree(node.path, kind, removeWithAnimation) }
        ]
      }}
    >
      {row}
    </Dropdown>
  )
}

// ---------- 行槽（D1 高度槽 + D2/D3 出入场动画） ----------
function Slot(props: { node: RowView; enterDelay: number; removing?: boolean }): React.JSX.Element {
  const { node } = props
  const delays = useContext(ClosingDelaysCtx) // 非 null = 处于收拢子树
  const closing = delays !== null
  const exitDelay = delays?.get(node.path) ?? 0
  const expandedKeys = useTreeStore((s) => s.expandedKeys)
  const closingPaths = useContext(ClosingPathsCtx)
  const childOpen = node.hasChildren && (expandedKeys.includes(node.path) || closingPaths.has(node.path))

  // 取消收拢回弹：closing true→false 时钉住（禁止 deal-in 重播，CSS .slot.settled）
  const [settled, setSettled] = useState(false)
  const prevClosing = useRef(closing)
  useEffect(() => {
    if (prevClosing.current && !closing) setSettled(true)
    prevClosing.current = closing
  }, [closing])

  return (
    <div
      className={`slot${closing ? ' closing' : ''}${settled && !closing ? ' settled' : ''}${props.removing ? ' removing' : ''}`}
      style={{ '--enter-delay': `${props.enterDelay}ms`, ...(closing ? { '--exit-delay': `${exitDelay}ms` } : {}) } as React.CSSProperties}
    >
      <div className="slot-inner">
        {/* .deal=发牌动画包装（dnd transform 在内层 .tree-row 上，动画与拖拽互不覆盖） */}
        <div className="deal">
          <TreeRow node={node} />
        </div>
        {childOpen && <TreeGroup parentPath={node.path} depth={node.depth + 1} />}
      </div>
    </div>
  )
}

// ---------- 组：某父路径的直接子行序列（波次按发牌方向偏好排布） ----------
function TreeGroup(props: { parentPath: string; depth: number }): React.JSX.Element | null {
  const { parentPath, depth } = props
  const children = useTreeStore((s) => s.childrenMap[parentPath])
  const loaded = useTreeStore((s) => s.loaded)
  const expandedKeys = useTreeStore((s) => s.expandedKeys)
  const closingPaths = useContext(ClosingPathsCtx)
  const removingPaths = useContext(RemovingPathsCtx)
  const dealDirection = usePrefStore((s) => s.dealDirection)
  const inheritedDelays = useContext(ClosingDelaysCtx) // 祖先收拢中 → 波次沿用祖先的表

  const open = expandedKeys.includes(parentPath) || closingPaths.has(parentPath)
  const ownClosing = closingPaths.has(parentPath) && !expandedKeys.includes(parentPath)

  // 自身发起收拢：构建「全部揭示行槽 → 出场延迟」波次表（收拢方向=发牌方向的反向）
  const ownDelays = useMemo(() => {
    if (!ownClosing) return null
    const st = useTreeStore.getState()
    const revealed = collectRevealedSlots(parentPath, st.childrenMap, st.expandedKeys, closingPaths)
    const s = effStagger(revealed.length)
    const n = revealed.length
    const m = new Map<string, number>()
    revealed.forEach((p, i) => {
      const exitIdx = dealDirection === 'top' ? n - 1 - i : i
      m.set(p, Math.round(exitIdx * s))
    })
    return m
  }, [ownClosing, parentPath, closingPaths, dealDirection])

  const delays = ownDelays ?? inheritedDelays

  if (!open) return null
  const kids = children ?? []
  const s = effStagger(kids.length)
  return (
    <ClosingDelaysCtx.Provider value={delays}>
      {kids.map((c, i) => {
        const enterIdx = dealDirection === 'top' ? i : kids.length - 1 - i
        const node: RowView = {
          path: c.path,
          name: c.name,
          kind: c.kind,
          hasChildren: c.has_children,
          depth,
          expanded: expandedKeys.includes(c.path),
          loaded: loaded[c.path] === true
        }
        return <Slot key={c.path} node={node} enterDelay={Math.round(enterIdx * s)} removing={removingPaths.has(c.path)} />
      })}
    </ClosingDelaysCtx.Provider>
  )
}

export default function PlanTreePanel(): React.JSX.Element {
  const { childrenMap, loaded, expandedKeys, selectedPath, loadChildren, select, setExpanded, movePlan, removePlan } = useTreeStore()
  const openPlan = usePlanStore((s) => s.open)
  const closePlan = usePlanStore((s) => s.close)
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const { t } = useTranslation()

  useEffect(() => {
    void loadChildren('')
  }, [loadChildren])

  // 收拢中路径（延迟卸载）：状态已翻转但组保留播完收牌动画；中途再点=取消回弹
  const [closingPaths, setClosingPaths] = useState<Set<string>>(() => new Set())
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const removeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 删除中路径（行槽平滑收拢后真删——2026-09-10 用户反馈：删除此前瞬间消失）
  const [removingPaths, setRemovingPaths] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    const timers = closeTimers.current
    const rTimers = removeTimers.current
    return () => {
      timers.forEach((t) => clearTimeout(t)) // 卸载清残留
      rTimers.forEach((t) => clearTimeout(t))
    }
  }, [])

  // 被拖行 path（null=非拖拽中）：驱动根/文件夹行的「可接收」高亮判定
  const [activeId, setActiveId] = useState<string | null>(null)

  // 目标可接收判定：非被拖项自身/子孙（防循环嵌套）、非现父（已在其中=无意义移动）
  const canReceive = (dragPath: string, target: string): boolean =>
    dragPath !== target && !isSelfOrDescendant(dragPath, target) && parentRel(dragPath) !== target

  const onToggle = (node: RowView): void => {
    if (!node.hasChildren) return
    const p = node.path
    if (closingPaths.has(p)) {
      // 取消收拢：清定时器、组恢复展开（settled 钉住防重播）；未加载过则补懒加载
      const t = closeTimers.current.get(p)
      if (t) {
        clearTimeout(t)
        closeTimers.current.delete(p)
      }
      setClosingPaths((s) => {
        const n = new Set(s)
        n.delete(p)
        return n
      })
      const st = useTreeStore.getState()
      if (!st.expandedKeys.includes(p)) setExpanded([...st.expandedKeys, p])
      if (!st.loaded[p]) void loadChildren(p)
      return
    }
    const st = useTreeStore.getState() // 读最新状态，防闭包过期
    if (st.expandedKeys.includes(p)) {
      // 收拢：状态立即翻转 + 延迟卸载（播完收牌波次）
      const nextExpanded = st.expandedKeys.filter((k) => k !== p)
      setExpanded(nextExpanded)
      const nextClosing = new Set(closingPaths)
      nextClosing.add(p)
      const revealed = collectRevealedSlots(p, st.childrenMap, nextExpanded, nextClosing)
      const s = effStagger(revealed.length)
      const total = Math.max((revealed.length - 1) * s + tokenMs('--t-gather', 260) + 60, 200)
      setClosingPaths(nextClosing)
      const timer = setTimeout(() => {
        closeTimers.current.delete(p)
        setClosingPaths((prev) => {
          const n = new Set(prev)
          n.delete(p)
          return n
        })
      }, total)
      closeTimers.current.set(p, timer)
      return
    }
    // 展开：组随 expandedKeys 挂载（发牌入场）；未加载则懒加载
    setExpanded([...st.expandedKeys, p])
    if (!st.loaded[p]) void loadChildren(p)
  }

  const onOpen = (node: RowView): void => {
    if (node.kind === 'folder') {
      select(node.path, 'folder')
      closePlan()
    } else {
      select(node.path, 'plan')
      void openPlan(node.path)
    }
  }

  // 删除=行槽平滑收拢（.slot.removing，独立于折叠 closing 通道——被删行自身收合不弹回），
  // 动画完执行真删除。此前版本复用 closingPaths 失败：被删行所在父组波次表为 null，
  // 其 Slot 的 closing 恒 false（首版"没看到动画"的根因，2026-09-10）
  const removeWithAnimation = (path: string): void => {
    setRemovingPaths((prev) => new Set(prev).add(path))
    const total = Math.max(tokenMs('--t-gather', 260) + 60, 200)
    const timer = setTimeout(() => {
      removeTimers.current.delete(path)
      setRemovingPaths((prev) => {
        const n = new Set(prev)
        n.delete(path)
        return n
      })
      void removePlan(path)
    }, total)
    removeTimers.current.set(path, timer)
  }

  // Delete 快捷键等面板外入口的动画删除请求（seq 变化即触发；同路径重复删除也生效）
  const animRemove = useTreeStore((s) => s.animRemove)
  const animSeq = animRemove?.seq ?? 0
  const animPath = animRemove?.path ?? null
  useEffect(() => {
    if (animSeq > 0 && animPath) removeWithAnimation(animPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animSeq])

  // 碰撞：指针所在行命中；剔除被拖项自身（文件夹行自身也是落点，须排除）
  const treeCollision: CollisionDetection = (args) =>
    pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id !== args.active.id) })

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const dragPath = String(active.id)
    setActiveId(null)
    if (!over) return
    const target = String(over.id) // ''=根（移到顶层）
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

  const root: RowView = {
    path: '',
    name: 'root',
    kind: 'root',
    hasChildren: loaded[''] === true ? (childrenMap[''] ?? []).length > 0 : true,
    depth: 0,
    expanded: expandedKeys.includes(''),
    loaded: loaded[''] === true
  }

  const uiCtx: TreeUiCtxValue = { onToggle, onOpen, activeId, canReceive, selectedPath, removeWithAnimation }

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
          <ClosingPathsCtx.Provider value={closingPaths}>
          <RemovingPathsCtx.Provider value={removingPaths}>
            <TreeUiCtx.Provider value={uiCtx}>
              <TreeRow node={root} />
              <TreeGroup parentPath="" depth={1} />
            </TreeUiCtx.Provider>
          </RemovingPathsCtx.Provider>
          </ClosingPathsCtx.Provider>
        </DndContext>
      </div>
      <div className="tree-footer">
        <button type="button" className="dashed-btn" onClick={() => openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })}>
          <PlusOutlined /> {t('tree.newPlanBtn')}
        </button>
        <button type="button" className="dashed-btn" onClick={() => openNameDialog({ mode: 'create-folder', targetPath: '', initialName: '' })}>
          <FolderAddOutlined /> {t('tree.newFolderBtn')}
        </button>
      </div>
    </>
  )
}

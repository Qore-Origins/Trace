// WorkspaceView（§2.2）：双栏工作台；<960px 树折叠为抽屉
// 全局交互底座（搜索浮层/命名对话框/设置弹窗 + 全局快捷键）已提升至 App（评审 Important-1），
// 本视图只保留树选中相关快捷键（F2 重命名 / Delete 删除）——选中态仅工作台可见，日记视图不误删隐藏选中
import { useEffect, useRef, useState } from 'react'
import { Drawer, Grid } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import TopBar from '../components/TopBar'
import PlanTreePanel from '../components/PlanTreePanel'
import ContentArea from '../components/ContentArea'
import StatusBar from '../components/StatusBar'
import TreeResizer from '../components/TreeResizer'
import { useTreeStore } from '../stores/tree-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { usePrefStore } from '../stores/pref-store'
import { useTranslation } from '../i18n'

function useNarrow(): boolean {
  const screens = Grid.useBreakpoint()
  return screens.lg === false
}

// 输入控件内不劫持快捷键（Delete/F2 只作用于选中节点）
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export default function WorkspaceView(): React.JSX.Element {
  const { t } = useTranslation()
  const narrow = useNarrow()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { selectedPath, selectedKind } = useTreeStore()
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const treeWidth = usePrefStore((s) => s.treeWidth)
  const treeBoxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e)) return
      if (e.key === 'F2' && selectedPath) {
        e.preventDefault()
        openNameDialog({ mode: 'rename', targetPath: selectedPath, initialName: selectedPath.slice(selectedPath.lastIndexOf('/') + 1) })
        return
      }
      if (e.key === 'Delete' && selectedPath) {
        e.preventDefault()
        // 动画删除：经 store 请求通道由树面板执行收拢动画（与右键删除一致）
        confirmRemoveTree(selectedPath, selectedKind ?? 'plan', (p) => useTreeStore.getState().requestAnimRemove(p))
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPath, selectedKind, openNameDialog])

  const tree = <PlanTreePanel />

  return (
    <div className="ws">
      <TopBar />
      {narrow ? (
        <div className="ws-main">
          <div style={{ padding: 8 }}>
            <button
              type="button"
              className="lite-btn"
              aria-label={t('tree.openTree')}
              onClick={() => setDrawerOpen(true)}
              style={{ border: '1px solid var(--split)', borderRadius: 6, padding: '6px 10px', background: '#fff' }}
            >
              <MenuOutlined /> {t('tree.panelTitle')}
            </button>
          </div>
          <ContentArea />
          <Drawer title={t('tree.panelTitle')} placement="left" width={300} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            {tree}
          </Drawer>
        </div>
      ) : (
        <div className="ws-main">
          <div className="ws-tree" ref={treeBoxRef} style={{ width: treeWidth }}>
            {tree}
            <TreeResizer targetRef={treeBoxRef} />
          </div>
          <ContentArea />
        </div>
      )}
      <StatusBar />
    </div>
  )
}

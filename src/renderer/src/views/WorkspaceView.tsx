// WorkspaceView（§2.2）：双栏工作台；<960px 树折叠为抽屉；全局快捷键；命名对话框单点挂载
import { useEffect, useState } from 'react'
import { Drawer, Grid } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import TopBar from '../components/TopBar'
import PlanTreePanel from '../components/PlanTreePanel'
import ContentArea from '../components/ContentArea'
import StatusBar from '../components/StatusBar'
import NameDialogModal from '../components/NameDialogModal'
import { useTreeStore } from '../stores/tree-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { invoke } from '../ipc-client'

function useNarrow(): boolean {
  const screens = Grid.useBreakpoint()
  return screens.lg === false
}

// 输入控件内不劫持快捷键（Delete/F2 等只作用于选中节点）
function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

export default function WorkspaceView(): React.JSX.Element {
  const narrow = useNarrow()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const { selectedPath, selectedKind, refreshAll } = useTreeStore()
  const openNameDialog = useUiStore((s) => s.openNameDialog)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTypingTarget(e)) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })
        return
      }
      if (e.key === 'F2' && selectedPath) {
        e.preventDefault()
        openNameDialog({ mode: 'rename', targetPath: selectedPath, initialName: selectedPath.slice(selectedPath.lastIndexOf('/') + 1) })
        return
      }
      if (e.key === 'Delete' && selectedPath) {
        e.preventDefault()
        confirmRemoveTree(selectedPath, selectedKind ?? 'plan')
        return
      }
      if (e.key === 'F5') {
        e.preventDefault()
        void refreshAll()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        void invoke('window:toggleDevtools').catch(() => undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedPath, selectedKind, refreshAll, openNameDialog])

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
              aria-label="打开计划树"
              onClick={() => setDrawerOpen(true)}
              style={{ border: '1px solid var(--split)', borderRadius: 6, padding: '6px 10px', background: '#fff' }}
            >
              <MenuOutlined /> 计划树
            </button>
          </div>
          <ContentArea />
          <Drawer title="计划树" placement="left" width={300} open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            {tree}
          </Drawer>
        </div>
      ) : (
        <div className="ws-main">
          <div className="ws-tree">{tree}</div>
          <ContentArea />
        </div>
      )}
      <StatusBar />
      <NameDialogModal />
    </div>
  )
}

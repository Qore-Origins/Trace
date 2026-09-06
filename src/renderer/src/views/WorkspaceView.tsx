// WorkspaceView（§2.2）：双栏工作台；<960px 树折叠为抽屉；全局快捷键；命名对话框单点挂载
import { useEffect, useState } from 'react'
import { Button, Descriptions, Drawer, Grid, Modal } from 'antd'
import { MenuOutlined } from '@ant-design/icons'
import TopBar from '../components/TopBar'
import PlanTreePanel from '../components/PlanTreePanel'
import ContentArea from '../components/ContentArea'
import StatusBar from '../components/StatusBar'
import NameDialogModal from '../components/NameDialogModal'
import SearchOverlay from '../components/SearchOverlay'
import { useTreeStore } from '../stores/tree-store'
import { useUiStore, confirmRemoveTree } from '../stores/ui-store'
import { useSearchStore } from '../stores/search-store'
import { useAppStore } from '../stores/app-store'
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
  const setSearchOpen = useSearchStore((s) => s.setOpen)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === ',' )) { e.preventDefault(); useUiStore.getState().setSettingsOpen(true); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault() // 搜索快捷键优先于输入焦点判断（输入框内 Ctrl+F 也应打开溯源）
        setSearchOpen(true)
        return
      }
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
  }, [selectedPath, selectedKind, refreshAll, openNameDialog, setSearchOpen])

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
      <SearchOverlay />
      <TopBarSettingsHost />
    </div>
  )
}

// 设置弹窗挂载（Ctrl+, 与 文件菜单共用 ui-store 开合）
function TopBarSettingsHost(): React.JSX.Element {
  const open = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const { rootDir, switchRootDir } = useAppStore()
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (open && !version) {
      void invoke('app:getAppInfo')
        .then((info) => setVersion(`${info.appVersion}（存储契约 v${info.formatVersion}）`))
        .catch(() => setVersion('-'))
    }
  }, [open, version])

  const shortcuts: Array<[string, string]> = [
    ['Ctrl + F', '溯源检索'],
    ['Ctrl + N', '新建计划'],
    ['F2', '重命名选中'],
    ['Delete', '删除选中'],
    ['F5', '刷新计划树'],
    ['Ctrl + ,', '设置'],
    ['Ctrl + Shift + I', '开发者工具']
  ]

  return (
    <Modal title="设置" open={open} onCancel={() => setSettingsOpen(false)} footer={<Button onClick={() => setSettingsOpen(false)}>关闭</Button>}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="计划库根目录">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
            <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 12 }}>{rootDir ?? '未配置'}</span>
            <Button size="small" onClick={() => void switchRootDir()}>
              切换…
            </Button>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label="版本">{version || '…'}</Descriptions.Item>
        <Descriptions.Item label="数据">
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>明文件存储于计划库根目录，可随时整库拷贝备份；数据不出设备</span>
        </Descriptions.Item>
        <Descriptions.Item label="快捷键">
          <div style={{ fontSize: 12, lineHeight: 1.9 }}>
            {shortcuts.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-3)' }}>{v}</span>
                <span style={{ fontFamily: 'Consolas, monospace' }}>{k}</span>
              </div>
            ))}
          </div>
        </Descriptions.Item>
      </Descriptions>
    </Modal>
  )
}

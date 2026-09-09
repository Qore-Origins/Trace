// WorkspaceView（§2.2）：双栏工作台；<960px 树折叠为抽屉；全局快捷键；命名对话框单点挂载
// 2026-09-08 设置弹窗增设「偏好设置」：界面语言（中/英）+ 树发牌方向（首张/末张先发）
import { useEffect, useState } from 'react'
import { Button, Descriptions, Drawer, Grid, Modal, Radio } from 'antd'
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
import { usePrefStore, type DealDirection, type Language, type ScoreAnim } from '../stores/pref-store'
import { invoke } from '../ipc-client'
import { useTranslation } from '../i18n'

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
  const { t } = useTranslation()
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
  const { t } = useTranslation()
  const open = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const { rootDir, switchRootDir } = useAppStore()
  const { language, dealDirection, scoreAnim, setLanguage, setDealDirection, setScoreAnim } = usePrefStore()
  const [version, setVersion] = useState('')

  useEffect(() => {
    if (open && !version) {
      void invoke('app:getAppInfo')
        .then((info) => setVersion(t('about.version', { version: info.appVersion, format: info.formatVersion })))
        .catch(() => setVersion('-'))
    }
  }, [open, version, t])

  const shortcuts: Array<[string, string]> = [
    ['Ctrl + F', t('settings.scSearch')],
    ['Ctrl + N', t('settings.scNewPlan')],
    ['F2', t('settings.scRename')],
    ['Delete', t('settings.scDelete')],
    ['F5', t('settings.scRefresh')],
    ['Ctrl + ,', t('settings.scSettings')],
    ['Ctrl + Shift + I', t('settings.scDevtools')]
  ]

  const prefLabel = (text: string): React.CSSProperties => ({ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 })

  return (
    <Modal title={t('settings.title')} open={open} onCancel={() => setSettingsOpen(false)} footer={<Button onClick={() => setSettingsOpen(false)}>{t('common.close')}</Button>}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label={t('settings.prefs')}>
          <div style={{ display: 'grid', gap: 12, minWidth: 260 }}>
            <div>
              <div style={prefLabel(t('settings.language'))}>{t('settings.language')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
              >
                <Radio.Button value="zh-CN">{t('settings.langZh')}</Radio.Button>
                <Radio.Button value="en-US">{t('settings.langEn')}</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <div style={prefLabel(t('settings.dealDirection'))}>{t('settings.dealDirection')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={dealDirection}
                onChange={(e) => setDealDirection(e.target.value as DealDirection)}
              >
                <Radio.Button value="top">{t('settings.dealTop')}</Radio.Button>
                <Radio.Button value="bottom">{t('settings.dealBottom')}</Radio.Button>
              </Radio.Group>
            </div>
            <div>
              <div style={prefLabel(t('settings.scoreAnim'))}>{t('settings.scoreAnim')}</div>
              <Radio.Group
                optionType="button"
                buttonStyle="solid"
                size="small"
                value={scoreAnim}
                onChange={(e) => setScoreAnim(e.target.value as ScoreAnim)}
              >
                <Radio.Button value="roll">{t('settings.scoreAnimRoll')}</Radio.Button>
                <Radio.Button value="none">{t('settings.scoreAnimNone')}</Radio.Button>
              </Radio.Group>
            </div>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.rootDir')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260 }}>
            <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 12 }}>{rootDir ?? t('settings.notConfigured')}</span>
            <Button size="small" onClick={() => void switchRootDir()}>
              {t('settings.switchBtn')}
            </Button>
          </div>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.version')}>{version || '…'}</Descriptions.Item>
        <Descriptions.Item label={t('settings.data')}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{t('settings.dataDesc')}</span>
        </Descriptions.Item>
        <Descriptions.Item label={t('settings.shortcuts')}>
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

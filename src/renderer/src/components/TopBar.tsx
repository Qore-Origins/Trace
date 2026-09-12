// TopBar（§2.2）：无边框标题栏——品牌 / 菜单栏（VS Code 式）/ 全局搜索 / 自绘窗口控制
// 2026-09-06：导入导出收进「文件」菜单（不再有独立按钮）；创建入口在树底与「文件」菜单
import { getMessage, getModal } from '../antd-host'
import { Dropdown, Input } from 'antd'
import type { MenuProps } from 'antd'
import WindowControls from './WindowControls'
import { useTreeStore } from '../stores/tree-store'
import { useAppStore } from '../stores/app-store'
import { useUiStore } from '../stores/ui-store'
import { useSearchStore } from '../stores/search-store'
import { invoke, ClientError } from '../ipc-client'
import { i18n, useTranslation } from '../i18n'

export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const setSearchOpen = useSearchStore((s) => s.setOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <div className="ws-top">
      <div className="brand">
        <span className="brand-dot" />
        溯源 Trace
      </div>
      <MenuBar />
      <ViewNav />
      <div className="search">
        <Input
          placeholder={t('search.topPlaceholder')}
          readOnly
          onFocus={() => setSearchOpen(true)}
        />
      </div>
      <div className="spacer" />
      <WindowControls />
    </div>
  )
}

// ---------- 视图导航（计划/日记）：Task 5 日记深化入口；路由=App 级 view 切换，此处只做入口与激活态 ----------
function ViewNav(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  return (
    <nav className="view-nav" aria-label={t('menu.view')}>
      <button type="button" className={`nav-btn${view === 'workspace' ? ' active' : ''}`} onClick={() => setView('workspace')}>
        {t('diary.navPlans')}
      </button>
      <button type="button" className={`nav-btn${view === 'diary' ? ' active' : ''}`} onClick={() => setView('diary')}>
        {t('diary.nav')}
      </button>
    </nav>
  )
}

// ---------- VS Code 式菜单栏（极简：无底色，悬停变色） ----------
function MenuBar(): React.JSX.Element {
  const { t } = useTranslation()
  const { selectedPath, selectedKind, exportPlan, exportPdf, exportPng, importPlan, importMarkdown, refreshAll } = useTreeStore()
  const switchRootDir = useAppStore((s) => s.switchRootDir)
  const openNameDialog = useUiStore((s) => s.openNameDialog)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  const run = async (action: () => Promise<string | null>): Promise<void> => {
    try {
      const msg = await action()
      if (msg) getMessage().success(msg, 5)
    } catch (e) {
      getMessage().error(e instanceof ClientError ? e.message : i18n.t('errors.opFailed'), 5)
    }
  }

  const fileMenu: MenuProps['items'] = [
    { key: 'new-plan', label: t('menu.newPlan'), extra: 'Ctrl+N', onClick: () => openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' }) },
    {
      key: 'new-child',
      label: t('menu.newChild'),
      disabled: !selectedPath,
      onClick: () => selectedPath && openNameDialog({ mode: 'create-plan', targetPath: selectedPath, initialName: '' })
    },
    { key: 'new-folder', label: t('menu.newFolder'), onClick: () => openNameDialog({ mode: 'create-folder', targetPath: '', initialName: '' }) },
    { type: 'divider' },
    { key: 'import-plan', label: t('menu.importPlan'), onClick: () => void run(() => importPlan(selectedPath ?? '')) },
    { key: 'import-md', label: t('menu.importMd'), onClick: () => void run(() => importMarkdown(selectedPath ?? '')) },
    {
      key: 'export',
      label: t('menu.exportPlan'),
      disabled: !selectedPath,
      onClick: () => selectedPath && void run(() => exportPlan(selectedPath))
    },
    {
      key: 'export-pdf',
      label: t('menu.exportPdf'),
      // 导出为仅计划可导（文件夹无内容渲染面——离屏 readPlan 会 PATH_NOT_FOUND）
      disabled: !selectedPath || selectedKind !== 'plan',
      onClick: () => selectedPath && void run(() => exportPdf(selectedPath))
    },
    {
      key: 'export-png',
      label: t('menu.exportPng'),
      disabled: !selectedPath || selectedKind !== 'plan',
      onClick: () => selectedPath && void run(() => exportPng(selectedPath))
    },
    { type: 'divider' },
    { key: 'switch-root', label: t('menu.switchRoot'), onClick: () => void switchRootDir() },
    { key: 'settings', label: t('menu.settings'), extra: 'Ctrl+,', onClick: () => setSettingsOpen(true) },
    { type: 'divider' },
    { key: 'quit', label: t('menu.quit'), onClick: () => void invoke('window:close').catch(() => undefined) }
  ]

  const editMenu: MenuProps['items'] = [
    {
      key: 'rename',
      label: t('menu.renameSelected'),
      extra: 'F2',
      disabled: !selectedPath,
      onClick: () =>
        selectedPath &&
        openNameDialog({ mode: 'rename', targetPath: selectedPath, initialName: selectedPath.slice(selectedPath.lastIndexOf('/') + 1) })
    },
    {
      key: 'delete',
      label: t('menu.deleteSelected'),
      extra: 'Del',
      disabled: !selectedPath,
      onClick: () => selectedPath && import('../stores/ui-store').then((m) => m.confirmRemoveTree(selectedPath, useTreeStore.getState().selectedKind ?? 'plan'))
    }
  ]

  const viewMenu: MenuProps['items'] = [
    { key: 'refresh', label: t('menu.refreshTree'), extra: 'F5', onClick: () => void refreshAll() },
    { key: 'devtools', label: t('menu.devtools'), extra: 'Ctrl+Shift+I', onClick: () => void invoke('window:toggleDevtools').catch(() => undefined) }
  ]

  const helpMenu: MenuProps['items'] = [
    {
      key: 'about',
      label: t('menu.about'),
      onClick: () => {
        void invoke('app:getAppInfo')
          .then((info) => {
            getModal().info({
              title: t('about.title'),
              content: (
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div>{t('about.version', { version: info.appVersion, format: info.formatVersion })}</div>
                  <div>{t('about.dataLocal', { dir: info.rootDir ?? '-' })}</div>
                  <div style={{ color: 'var(--text-3)' }}>{t('about.by')}</div>
                </div>
              )
            })
          })
          .catch(() => undefined)
      }
    }
  ]

  const item = (label: string, items: MenuProps['items']): React.JSX.Element => (
    <Dropdown menu={{ items }} trigger={['click']}>
      <span className="menu-title" role="button" tabIndex={0}>
        {label}
      </span>
    </Dropdown>
  )

  return (
    <nav className="menubar" aria-label={t('menu.main')}>
      {item(t('menu.file'), fileMenu)}
      {item(t('menu.edit'), editMenu)}
      {item(t('menu.view'), viewMenu)}
      {item(t('menu.help'), helpMenu)}
    </nav>
  )
}

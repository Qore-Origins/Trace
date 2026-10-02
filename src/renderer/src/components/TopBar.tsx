// TopBar（§2.2）：无边框标题栏——品牌 / 菜单栏（VS Code 式）/ 全局搜索 / 自绘窗口控制
// 2026-09-06：导入导出收进「文件」菜单（不再有独立按钮）；创建入口在树底与「文件」菜单
import { getMessage, getModal } from '../antd-host'
import { Dropdown, Input } from 'antd'
import type { MenuProps } from 'antd'
import WindowControls from './WindowControls'
import PageNavigation from './PageNavigation'
import { useTreeStore } from '../stores/tree-store'
import { useAppStore } from '../stores/app-store'
import { confirmRemoveTree, useUiStore } from '../stores/ui-store'
import { useSearchStore } from '../stores/search-store'
import { invoke, ClientError } from '../ipc-client'
import { i18n, useTranslation } from '../i18n'

export default function TopBar(): React.JSX.Element {
  const { t } = useTranslation()
  const setSearchOpen = useSearchStore((s) => s.setOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <div className="ws-top">
      <div className="top-left">
        <div className="brand">
          <span className="brand-dot" />
          溯源 Trace
        </div>
        <MenuBar />
      </div>
      <div className="top-center">
        <ViewNav />
      </div>
      <div className="top-right">
        <div className="search">
          <Input
            placeholder={t('search.topPlaceholder')}
            readOnly
            onFocus={() => setSearchOpen(true)}
          />
        </div>
        <WindowControls />
      </div>
    </div>
  )
}

// ---------- 视图导航（计划/日记）：Task 5 日记深化入口；路由=App 级 view 切换，此处只做入口与激活态 ----------
function ViewNav(): React.JSX.Element {
  const { t } = useTranslation()
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)
  return (
    <PageNavigation
      currentView={view}
      onNavigate={setView}
      labels={{
        workspace: t('diary.navPlans'),
        diary: t('diary.nav'),
        memories: t('diary.navMemories'),
        agent: t('agentChat.nav')
      }}
      ariaLabel={t('navigation.pages')}
    />
  )
}

// ---------- VS Code 式菜单栏（极简：无底色，悬停变色） ----------
type MenuTranslation = ReturnType<typeof useTranslation>['t']
type TreeMenuState = ReturnType<typeof useTreeStore.getState>

interface MenuBarState {
  t: MenuTranslation
  tree: TreeMenuState
  switchRootDir: ReturnType<typeof useAppStore.getState>['switchRootDir']
  openNameDialog: ReturnType<typeof useUiStore.getState>['openNameDialog']
  setSettingsOpen: ReturnType<typeof useUiStore.getState>['setSettingsOpen']
}

interface MenuDescriptor {
  key: string
  label: string
  items: MenuProps['items']
}

type MenuItem = NonNullable<MenuProps['items']>[number]

function MenuBar(): React.JSX.Element {
  const state = useMenuBarState()
  const menus = createMenuDescriptors(state)

  return (
    <nav className="menubar" aria-label={state.t('menu.main')}>
      {menus.map((menu) => renderMenuItem(menu))}
    </nav>
  )
}

function useMenuBarState(): MenuBarState {
  const { t } = useTranslation()
  const tree = useTreeStore()
  const switchRootDir = useAppStore((state) => state.switchRootDir)
  const openNameDialog = useUiStore((state) => state.openNameDialog)
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  return { t, tree, switchRootDir, openNameDialog, setSettingsOpen }
}

function createMenuDescriptors(state: MenuBarState): MenuDescriptor[] {
  return [
    { key: 'file', label: state.t('menu.file'), items: createFileMenu(state) },
    { key: 'edit', label: state.t('menu.edit'), items: createEditMenu(state) },
    { key: 'view', label: state.t('menu.view'), items: createViewMenu(state) },
    { key: 'help', label: state.t('menu.help'), items: createHelpMenu(state.t) }
  ]
}

function createFileMenu(state: MenuBarState): MenuProps['items'] {
  return [
    ...createCreationMenuItems(state),
    { type: 'divider' },
    ...createTransferMenuItems(state),
    { type: 'divider' },
    ...createLibraryMenuItems(state)
  ]
}

function createCreationMenuItems({ t, tree, openNameDialog }: MenuBarState): MenuItem[] {
  const selectedPath = tree.selectedPath

  return [
    {
      key: 'new-plan',
      label: t('menu.newPlan'),
      extra: 'Ctrl+N',
      onClick: () => openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })
    },
    {
      key: 'new-child',
      label: t('menu.newChild'),
      disabled: !selectedPath,
      onClick: () => selectedPath && openNameDialog({
        mode: 'create-plan',
        targetPath: selectedPath,
        initialName: ''
      })
    },
    {
      key: 'new-folder',
      label: t('menu.newFolder'),
      onClick: () => openNameDialog({ mode: 'create-folder', targetPath: '', initialName: '' })
    }
  ]
}

function createTransferMenuItems({ t, tree }: MenuBarState): MenuItem[] {
  const selectedPath = tree.selectedPath

  return [
    {
      key: 'import-plan',
      label: t('menu.importPlan'),
      onClick: () => void runMenuAction(() => tree.importPlan(selectedPath ?? ''))
    },
    {
      key: 'import-md',
      label: t('menu.importMd'),
      onClick: () => void runMenuAction(() => tree.importMarkdown(selectedPath ?? ''))
    },
    {
      key: 'export',
      label: t('menu.exportPlan'),
      disabled: !selectedPath,
      onClick: () => selectedPath && void runMenuAction(() => tree.exportPlan(selectedPath))
    },
    {
      key: 'export-pdf',
      label: t('menu.exportPdf'),
      // 导出为仅计划可导（文件夹无内容渲染面——离屏 readPlan 会 PATH_NOT_FOUND）
      disabled: !selectedPath || tree.selectedKind !== 'plan',
      onClick: () => selectedPath && void runMenuAction(() => tree.exportPdf(selectedPath))
    },
    {
      key: 'export-png',
      label: t('menu.exportPng'),
      disabled: !selectedPath || tree.selectedKind !== 'plan',
      onClick: () => selectedPath && void runMenuAction(() => tree.exportPng(selectedPath))
    }
  ]
}

function createLibraryMenuItems({ t, switchRootDir, setSettingsOpen }: MenuBarState): MenuItem[] {
  return [
    { key: 'switch-root', label: t('menu.switchRoot'), onClick: () => void switchRootDir() },
    { key: 'settings', label: t('menu.settings'), extra: 'Ctrl+,', onClick: () => setSettingsOpen(true) },
    { type: 'divider' },
    { key: 'quit', label: t('menu.quit'), onClick: () => void invoke('window:close').catch(() => undefined) }
  ]
}

function createEditMenu({ t, tree, openNameDialog }: MenuBarState): MenuProps['items'] {
  const selectedPath = tree.selectedPath

  return [
    {
      key: 'rename',
      label: t('menu.renameSelected'),
      extra: 'F2',
      disabled: !selectedPath,
      onClick: () =>
        selectedPath &&
        openNameDialog({
          mode: 'rename',
          targetPath: selectedPath,
          initialName: selectedPath.slice(selectedPath.lastIndexOf('/') + 1)
        })
    },
    {
      key: 'delete',
      label: t('menu.deleteSelected'),
      extra: 'Del',
      disabled: !selectedPath,
      onClick: () => selectedPath && confirmRemoveTree(
        selectedPath,
        useTreeStore.getState().selectedKind ?? 'plan'
      )
    }
  ]
}

function createViewMenu({ t, tree }: MenuBarState): MenuProps['items'] {
  return [
    { key: 'refresh', label: t('menu.refreshTree'), extra: 'F5', onClick: () => void tree.refreshAll() },
    {
      key: 'devtools',
      label: t('menu.devtools'),
      extra: 'Ctrl+Shift+I',
      onClick: () => void invoke('window:toggleDevtools').catch(() => undefined)
    }
  ]
}

function createHelpMenu(t: MenuTranslation): MenuProps['items'] {
  return [
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
}

async function runMenuAction(action: () => Promise<string | null>): Promise<void> {
  try {
    const message = await action()
    if (message) getMessage().success(message, 5)
  } catch (error) {
    const message = error instanceof ClientError ? error.message : i18n.t('errors.opFailed')
    getMessage().error(message, 5)
  }
}

function renderMenuItem({ key, label, items }: MenuDescriptor): React.JSX.Element {
  return (
    <Dropdown key={key} menu={{ items }} trigger={['click']}>
      <button type="button" className="menu-title">
        {label}
      </button>
    </Dropdown>
  )
}

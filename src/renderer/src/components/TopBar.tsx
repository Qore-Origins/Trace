// TopBar（§2.2）：无边框标题栏——品牌 / 菜单栏（VS Code 式）/ 全局搜索（Sprint 3）/ 自绘窗口控制
// 2026-09-06：导入导出收进「文件」菜单（不再有独立按钮）；创建入口在树底与「文件」菜单
import { Dropdown, Input, Modal, message } from 'antd'
import type { MenuProps } from 'antd'
import WindowControls from './WindowControls'
import { useTreeStore } from '../stores/tree-store'
import { useAppStore } from '../stores/app-store'
import { useUiStore } from '../stores/ui-store'
import { useSearchStore } from '../stores/search-store'
import { invoke, ClientError } from '../ipc-client'

export default function TopBar(): React.JSX.Element {
  const setSearchOpen = useSearchStore((s) => s.setOpen)

  return (
    <div className="ws-top">
      <div className="brand">
        <span className="brand-dot" />
        溯源 Trace
      </div>
      <MenuBar />
      <div className="search">
        <Input
          placeholder="搜索：沿迹回望计划 / 任务 / 注释…（Ctrl+F）"
          readOnly
          onFocus={() => setSearchOpen(true)}
        />
      </div>
      <div className="spacer" />
      <WindowControls />
    </div>
  )
}

// ---------- VS Code 式菜单栏（极简：无底色，悬停变色） ----------
function MenuBar(): React.JSX.Element {
  const { selectedPath, selectedKind, exportPlan, importPlan, importMarkdown, refreshAll } = useTreeStore()
  const switchRootDir = useAppStore((s) => s.switchRootDir)
  const openNameDialog = useUiStore((s) => s.openNameDialog)

  const run = async (action: () => Promise<string | null>): Promise<void> => {
    try {
      const msg = await action()
      if (msg) message.success(msg, 5)
    } catch (e) {
      message.error(e instanceof ClientError ? e.message : '操作失败', 5)
    }
  }

  const fileMenu: MenuProps['items'] = [
    { key: 'new-plan', label: '新建计划', extra: 'Ctrl+N', onClick: () => openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' }) },
    {
      key: 'new-child',
      label: '新建子项（在选中位置）',
      disabled: !selectedPath,
      onClick: () => selectedPath && openNameDialog({ mode: 'create-plan', targetPath: selectedPath, initialName: '' })
    },
    { key: 'new-folder', label: '新建文件夹', onClick: () => openNameDialog({ mode: 'create-folder', targetPath: '', initialName: '' }) },
    { type: 'divider' },
    { key: 'import-plan', label: '导入 .plan…', onClick: () => void run(() => importPlan(selectedPath ?? '')) },
    { key: 'import-md', label: '迁入 Markdown 计划…', onClick: () => void run(() => importMarkdown(selectedPath ?? '')) },
    {
      key: 'export',
      label: '导出当前计划 (.plan)…',
      disabled: !selectedPath,
      onClick: () => selectedPath && void run(() => exportPlan(selectedPath))
    },
    { type: 'divider' },
    { key: 'switch-root', label: '切换计划库目录…', onClick: () => void switchRootDir() },
    { type: 'divider' },
    { key: 'quit', label: '退出', onClick: () => void invoke('window:close').catch(() => undefined) }
  ]

  const editMenu: MenuProps['items'] = [
    {
      key: 'rename',
      label: '重命名选中',
      extra: 'F2',
      disabled: !selectedPath,
      onClick: () =>
        selectedPath &&
        openNameDialog({ mode: 'rename', targetPath: selectedPath, initialName: selectedPath.slice(selectedPath.lastIndexOf('/') + 1) })
    },
    {
      key: 'delete',
      label: '删除选中',
      extra: 'Del',
      disabled: !selectedPath,
      onClick: () => selectedPath && import('../stores/ui-store').then((m) => m.confirmRemoveTree(selectedPath, selectedKind ?? 'plan'))
    }
  ]

  const viewMenu: MenuProps['items'] = [
    { key: 'refresh', label: '刷新计划树', extra: 'F5', onClick: () => void refreshAll() },
    { key: 'devtools', label: '开发者工具', extra: 'Ctrl+Shift+I', onClick: () => void invoke('window:toggleDevtools').catch(() => undefined) }
  ]

  const helpMenu: MenuProps['items'] = [
    {
      key: 'about',
      label: '关于 溯源 Trace',
      onClick: () => {
        void invoke('app:getAppInfo')
          .then((info) => {
            Modal.info({
              title: '溯源 Trace · 计划有迹可循',
              content: (
                <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                  <div>版本 {info.appVersion}（存储契约 {info.formatVersion}）</div>
                  <div>数据完全本地：{info.rootDir ?? '-'}</div>
                  <div style={{ color: 'var(--text-3)' }}>by Qore（叩心）</div>
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
    <nav className="menubar" aria-label="主菜单">
      {item('文件', fileMenu)}
      {item('编辑', editMenu)}
      {item('查看', viewMenu)}
      {item('帮助', helpMenu)}
    </nav>
  )
}

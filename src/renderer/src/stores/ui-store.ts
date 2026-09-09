// uiStore：跨组件 UI 状态（命名对话框由 树底按钮/节点菜单/顶栏菜单/快捷键 共用触发，单点挂载）
import { create } from 'zustand'
import { Modal } from 'antd'
import { useTreeStore } from './tree-store'
import { i18n } from '../i18n'

export type NameDialogMode = 'create-plan' | 'create-folder' | 'rename' | 'preset'

// 顶栏视图（纯 session 态，不持久化）：workspace 默认；diary 路由由 App 渲染（导航入口 Task 5 接线）
export type ViewName = 'workspace' | 'diary'

// 命名对话框的定制分支（如预设保存）：title/placeholder/okText/校验/提交动作全部由调用方注入，
// mode:'preset' 仅作判别（preset 分支完全由 customize 驱动）
export interface NameDialogCustomize {
  titleKey: string
  placeholderKey: string
  okTextKey: string
  validate: (name: string) => string | null // 违规返回消息，空=通过
  onSubmit: (name: string) => Promise<void>
}

export interface NameDialog {
  mode: NameDialogMode
  targetPath: string // 新建=父路径（''=顶层）；重命名=节点路径
  initialName: string
  customize?: NameDialogCustomize
}

interface UiState {
  nameDialog: NameDialog | null
  settingsOpen: boolean
  view: ViewName
  openNameDialog: (d: NameDialog) => void
  closeNameDialog: () => void
  setSettingsOpen: (open: boolean) => void
  setView: (view: ViewName) => void
}

export const useUiStore = create<UiState>()((set) => ({
  nameDialog: null,
  settingsOpen: false,
  view: 'workspace',
  openNameDialog: (d) => set({ nameDialog: d }),
  closeNameDialog: () => set({ nameDialog: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setView: (view) => set({ view })
}))

// 删除确认（树节点：计划/文件夹共用；BR-007 二次确认）
export function confirmRemoveTree(path: string, kind: 'plan' | 'folder'): void {
  const name = path.slice(path.lastIndexOf('/') + 1)
  Modal.confirm({
    title: i18n.t(kind === 'folder' ? 'confirm.deleteFolderTitle' : 'confirm.deletePlanTitle', { name }),
    content: i18n.t(kind === 'folder' ? 'confirm.deleteFolderDesc' : 'confirm.deletePlanDesc'),
    okText: i18n.t('common.delete'),
    okButtonProps: { danger: true },
    cancelText: i18n.t('common.cancel'),
    onOk: () => useTreeStore.getState().removePlan(path).catch(() => undefined)
  })
}

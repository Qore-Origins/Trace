// uiStore：跨组件 UI 状态（命名对话框由 树底按钮/节点菜单/顶栏菜单/快捷键 共用触发，单点挂载）
import { create } from 'zustand'
import { Modal } from 'antd'
import { useTreeStore } from './tree-store'

export type NameDialogMode = 'create-plan' | 'create-folder' | 'rename'

export interface NameDialog {
  mode: NameDialogMode
  targetPath: string // 新建=父路径（''=顶层）；重命名=节点路径
  initialName: string
}

interface UiState {
  nameDialog: NameDialog | null
  settingsOpen: boolean
  openNameDialog: (d: NameDialog) => void
  closeNameDialog: () => void
  setSettingsOpen: (open: boolean) => void
}

export const useUiStore = create<UiState>()((set) => ({
  nameDialog: null,
  settingsOpen: false,
  openNameDialog: (d) => set({ nameDialog: d }),
  closeNameDialog: () => set({ nameDialog: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open })
}))

// 删除确认（树节点：计划/文件夹共用；BR-007 二次确认）
export function confirmRemoveTree(path: string, kind: 'plan' | 'folder'): void {
  const name = path.slice(path.lastIndexOf('/') + 1)
  Modal.confirm({
    title: `删除${kind === 'folder' ? '文件夹' : '计划'}「${name}」？`,
    content: kind === 'folder' ? '其全部子计划与内容将被删除，且不可恢复。' : '该计划及其全部内容、子计划将被删除，且不可恢复。',
    okText: '删除',
    okButtonProps: { danger: true },
    cancelText: '取消',
    onOk: () => useTreeStore.getState().removePlan(path).catch(() => undefined)
  })
}

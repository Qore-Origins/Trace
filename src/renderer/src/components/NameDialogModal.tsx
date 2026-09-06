// 命名对话框（单点挂载）：新建计划/文件夹、重命名——由树底按钮、节点菜单、顶栏菜单、快捷键共用触发
import { useState } from 'react'
import { Input, Modal } from 'antd'
import { useUiStore, type NameDialogMode } from '../stores/ui-store'
import { useTreeStore } from '../stores/tree-store'

const TITLE: Record<NameDialogMode, string> = {
  'create-plan': '新建计划',
  'create-folder': '新建文件夹',
  rename: '重命名'
}

export default function NameDialogModal(): React.JSX.Element {
  const dialog = useUiStore((s) => s.nameDialog)
  const close = useUiStore((s) => s.closeNameDialog)
  const { createPlan, createFolder, renamePlan } = useTreeStore()
  const [value, setValue] = useState('')

  // 对话框打开时同步初值（受控开关：仅在 dialog 变化时重置）
  const [lastKey, setLastKey] = useState<string | null>(null)
  const openKey = dialog ? `${dialog.mode}:${dialog.targetPath}` : null
  if (openKey !== null && openKey !== lastKey) {
    setLastKey(openKey)
    setValue(dialog?.initialName ?? '')
  }

  const submit = async (): Promise<void> => {
    if (!dialog || !value.trim()) return
    const name = value.trim()
    try {
      if (dialog.mode === 'create-plan') await createPlan(dialog.targetPath, name)
      else if (dialog.mode === 'create-folder') await createFolder(dialog.targetPath, name)
      else if (dialog.mode === 'rename' && name !== dialog.initialName) await renamePlan(dialog.targetPath, name)
      close()
    } catch {
      // 重名等错误提示由 IPC 层弹出；对话框保持开启供修改
    }
  }

  return (
    <Modal
      title={dialog ? TITLE[dialog.mode] : ''}
      open={dialog !== null}
      onOk={() => void submit()}
      onCancel={close}
      okText={dialog?.mode === 'rename' ? '重命名' : '创建'}
      cancelText="取消"
      destroyOnClose
    >
      <Input
        placeholder={dialog?.mode === 'create-folder' ? '文件夹名称' : '计划名称'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={() => void submit()}
        autoFocus
      />
    </Modal>
  )
}

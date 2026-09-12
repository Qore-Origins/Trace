// 命名对话框（单点挂载）：新建计划/文件夹、重命名、保存预设——由树底按钮、节点菜单、顶栏菜单、快捷键、卡内按钮共用触发
import { getMessage, getModal } from '../antd-host'
import { useState } from 'react'
import { Input, Modal } from 'antd'
import { useUiStore, type NameDialogMode } from '../stores/ui-store'
import { useTreeStore } from '../stores/tree-store'
import { ClientError } from '../ipc-client'
import { useTranslation } from '../i18n'

export default function NameDialogModal(): React.JSX.Element {
  const { t } = useTranslation()
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
  // 关闭时复位：下次打开必须从 initialName 重来（preset 对话框 targetPath 恒 ''，key 不变，不复位会残留上次输入的预设名）
  if (dialog === null && lastKey !== null) {
    setLastKey(null)
    setValue('')
  }

  const submit = async (): Promise<void> => {
    if (!dialog) return
    const name = value.trim()
    // 定制分支（预设保存等）：校验失败弹错误并保持开启；成功提交后关闭
    if (dialog.customize) {
      const err = dialog.customize.validate(name)
      if (err) {
        getMessage().error(err)
        return
      }
      await dialog.customize.onSubmit(name)
      close()
      return
    }
    if (!name) return
    try {
      if (dialog.mode === 'create-plan') await createPlan(dialog.targetPath, name)
      else if (dialog.mode === 'create-folder') await createFolder(dialog.targetPath, name)
      else if (dialog.mode === 'rename' && name !== dialog.initialName) await renamePlan(dialog.targetPath, name)
      close()
    } catch (e) {
      // 弹出失败原因（重名等），对话框保持开启供改名重试
      // ——此前静默吞错（注释声称"IPC 层弹出"但该机制不存在），用户看到"点击没效果"（2026-09-10）
      getMessage().error(e instanceof ClientError ? e.message : t('errors.opFailed'))
    }
  }

  const title = dialog?.customize
    ? t(dialog.customize.titleKey)
    : dialog?.mode === 'create-plan'
      ? t('dialog.createPlan')
      : dialog?.mode === 'create-folder'
        ? t('dialog.createFolder')
        : t('dialog.rename')

  return (
    <Modal
      title={title}
      open={dialog !== null}
      onOk={() => void submit()}
      onCancel={close}
      okText={dialog?.customize ? t(dialog.customize.okTextKey) : dialog?.mode === 'rename' ? t('dialog.renameBtn') : t('dialog.createBtn')}
      cancelText={t('common.cancel')}
      destroyOnHidden
    >
      <Input
        placeholder={dialog?.customize ? t(dialog.customize.placeholderKey) : dialog?.mode === 'create-folder' ? t('dialog.folderNamePlaceholder') : t('dialog.planNamePlaceholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPressEnter={() => void submit()}
        autoFocus
      />
    </Modal>
  )
}

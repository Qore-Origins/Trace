import { getMessage, getModal } from '../../antd-host'
import { useAppStore } from '../../stores/app-store'
import { i18n } from '../../i18n'
import { onceAction } from './action-policy'

interface ConfirmActionOptions {
  title: string
  description: string
  onConfirm: () => void | Promise<void>
  afterConfirm?: () => void
  afterCancel?: () => void
}
export function confirmAction({ title, description, onConfirm, afterConfirm, afterCancel }: ConfirmActionOptions): void {
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let confirmed = false
  const rootDir = useAppStore.getState().rootDir
  getModal().confirm({
    title, content: description,
    okText: i18n.t('common.delete'), cancelText: i18n.t('common.cancel'),
    okButtonProps: { danger: true }, autoFocusButton: 'cancel', keyboard: true,
    onOk: onceAction(async () => {
      if (useAppStore.getState().rootDir !== rootDir) {
        getMessage().warning(i18n.t('actions.staleConfirmation'))
        return
      }
      await onConfirm()
      confirmed = true
    }),
    afterClose: () => {
      if (confirmed && afterConfirm) afterConfirm()
      else if (trigger?.isConnected) trigger.focus()
      else afterCancel?.()
    }
  })
}

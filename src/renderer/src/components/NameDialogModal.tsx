// 命名对话框（单点挂载）：新建计划/文件夹、重命名、保存预设——由树底按钮、节点菜单、顶栏菜单、快捷键、卡内按钮共用触发
import { getMessage } from '../antd-host'
import { useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from 'antd'
import { ERR, TraceError } from '@shared/errors'
import { formatPlanNameTemplate } from '@shared/plan-name-templates'
import type { PlanNameTemplateSettings } from '@shared/plan-name-templates'
import { useUiStore, type NameDialog } from '../stores/ui-store'
import { useAppStore } from '../stores/app-store'
import { useTreeStore } from '../stores/tree-store'
import { ClientError, invoke } from '../ipc-client'
import { useTranslation } from '../i18n'

interface TemplateLoadState {
  dialog: NameDialog
  rootDir: string | null
  status: 'loading' | 'ready' | 'error'
  template: string | null
  error: string | null
}

function templateErrorText(error: unknown, t: (key: string) => string): string {
  const code = error instanceof ClientError || error instanceof TraceError ? error.code : undefined
  if (code === ERR.NAME_CONFLICT) return t('dialog.planNameConflict')
  if (code === ERR.VALIDATION) return t('dialog.planNameInvalid')
  return error instanceof Error && error.message ? error.message : t('errors.opFailed')
}

export default function NameDialogModal(): React.JSX.Element {
  const { t } = useTranslation()
  const dialog = useUiStore((s) => s.nameDialog)
  const close = useUiStore((s) => s.closeNameDialog)
  const rootDir = useAppStore((s) => s.rootDir)
  const { createPlan, createFolder, renamePlan } = useTreeStore()
  const [value, setValue] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [templateLoad, setTemplateLoad] = useState<TemplateLoadState | null>(null)
  const [loadSequence, setLoadSequence] = useState(0)
  const [templateDate, setTemplateDate] = useState(() => new Date())
  const loadGenerationRef = useRef(0)

  // 每次打开新的 dialog 对象都从 initialName 起步；根目录变化则保留当前输入，只重载该库的模板。
  const [lastDialog, setLastDialog] = useState<NameDialog | null>(null)
  if (dialog !== null && dialog !== lastDialog) {
    setLastDialog(dialog)
    setValue(dialog.initialName)
    setSubmitError(null)
  }
  if (dialog === null && lastDialog !== null) {
    setLastDialog(null)
    setValue('')
    setSubmitError(null)
  }

  useEffect(() => {
    const generation = ++loadGenerationRef.current
    if (dialog?.mode !== 'create-plan') {
      setTemplateLoad(null)
      return () => {
        if (loadGenerationRef.current === generation) loadGenerationRef.current += 1
      }
    }

    const currentDialog = dialog
    const currentRoot = rootDir
    const isCurrent = (): boolean =>
      loadGenerationRef.current === generation &&
      useUiStore.getState().nameDialog === currentDialog &&
      useAppStore.getState().rootDir === currentRoot

    if (!currentRoot) {
      setTemplateLoad({
        dialog: currentDialog,
        rootDir: currentRoot,
        status: 'error',
        template: null,
        error: t('dialog.templateUnavailable')
      })
      return () => {
        if (loadGenerationRef.current === generation) loadGenerationRef.current += 1
      }
    }

    setTemplateLoad({ dialog: currentDialog, rootDir: currentRoot, status: 'loading', template: null, error: null })
    setSubmitError(null)
    void invoke('plan-template:get')
      .then((settings: PlanNameTemplateSettings) => {
        if (!isCurrent()) return
        const rule = settings.rules.find((candidate) => candidate.parent_path === currentDialog.targetPath)
        setTemplateLoad({
          dialog: currentDialog,
          rootDir: currentRoot,
          status: 'ready',
          template: rule?.template ?? null,
          error: null
        })
      })
      .catch((error: unknown) => {
        if (!isCurrent()) return
        setTemplateLoad({
          dialog: currentDialog,
          rootDir: currentRoot,
          status: 'error',
          template: null,
          error: templateErrorText(error, t)
        })
      })

    return () => {
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1
    }
  }, [dialog, rootDir, loadSequence, t])

  const isPlanDialog = dialog?.mode === 'create-plan'
  const isCurrentLoad = isPlanDialog && templateLoad?.dialog === dialog && templateLoad.rootDir === rootDir
  const templateLoading = isPlanDialog && (!isCurrentLoad || templateLoad?.status === 'loading')
  const templateError = isPlanDialog && isCurrentLoad && templateLoad.status === 'error' ? templateLoad.error : null
  const template = isPlanDialog && isCurrentLoad && templateLoad.status === 'ready' ? templateLoad.template : null
  const templateConfigured = typeof template === 'string'

  useEffect(() => {
    if (dialog?.mode !== 'create-plan') return

    let midnightTimer: ReturnType<typeof setTimeout> | undefined
    const refreshAtNextLocalMidnight = (): void => {
      const now = new Date()
      setTemplateDate(now)
      const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      const delay = Math.max(1, nextLocalMidnight.getTime() - now.getTime())
      midnightTimer = setTimeout(refreshAtNextLocalMidnight, delay)
    }

    refreshAtNextLocalMidnight()
    return () => {
      if (midnightTimer !== undefined) clearTimeout(midnightTimer)
    }
  }, [dialog, rootDir])

  const submit = async (): Promise<void> => {
    if (!dialog) return
    const submittedDialog = dialog
    const submittedRoot = rootDir
    const isStillCurrent = (): boolean =>
      useUiStore.getState().nameDialog === submittedDialog &&
      useAppStore.getState().rootDir === submittedRoot
    const name = value.trim()
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

    if (dialog.mode === 'create-plan') {
      if (templateLoading || templateError) return
      if (!name) {
        if (templateConfigured) setSubmitError(t('dialog.planTitleEmpty'))
        return
      }

      try {
        const finalName = templateConfigured ? formatPlanNameTemplate(template, name, templateDate) : name
        await createPlan(dialog.targetPath, finalName)
        if (isStillCurrent()) close()
      } catch (error) {
        if (!isStillCurrent()) return
        if (templateConfigured) setSubmitError(templateErrorText(error, t))
        else getMessage().error(error instanceof ClientError ? error.message : t('errors.opFailed'))
      }
      return
    }

    if (!name) return
    try {
      if (dialog.mode === 'create-folder') await createFolder(dialog.targetPath, name)
      else if (dialog.mode === 'rename' && name !== dialog.initialName) await renamePlan(dialog.targetPath, name)
      close()
    } catch (error) {
      getMessage().error(error instanceof ClientError ? error.message : t('errors.opFailed'))
    }
  }

  const title = dialog?.customize
    ? t(dialog.customize.titleKey)
    : dialog?.mode === 'create-plan'
      ? t('dialog.createPlan')
      : dialog?.mode === 'create-folder'
        ? t('dialog.createFolder')
        : t('dialog.rename')

  let preview = ''
  if (templateConfigured && value.trim()) {
    try {
      preview = formatPlanNameTemplate(template, value.trim(), templateDate)
    } catch {
      preview = ''
    }
  }

  const inputLabel = dialog?.customize
    ? t(dialog.customize.placeholderKey)
    : dialog?.mode === 'create-plan' && templateConfigured
      ? t('dialog.planTitleLabel')
      : dialog?.mode === 'create-folder'
        ? t('dialog.folderNamePlaceholder')
        : t('dialog.planNamePlaceholder')
  const inputPlaceholder = dialog?.customize
    ? t(dialog.customize.placeholderKey)
    : dialog?.mode === 'create-plan' && templateConfigured
      ? t('dialog.planTitlePlaceholder')
      : dialog?.mode === 'create-folder'
        ? t('dialog.folderNamePlaceholder')
        : t('dialog.planNamePlaceholder')
  const okText = dialog?.customize
    ? t(dialog.customize.okTextKey)
    : dialog?.mode === 'rename'
      ? t('dialog.renameBtn')
      : t('dialog.createBtn')

  return (
    <Modal
      title={title}
      open={dialog !== null}
      onOk={() => void submit()}
      onCancel={close}
      okText={okText}
      cancelText={t('common.cancel')}
      okButtonProps={{ disabled: Boolean(templateLoading || templateError) }}
      destroyOnHidden
    >
      {isPlanDialog && templateLoading && <div role="status" aria-live="polite" className="name-dialog-template__status">{t('dialog.templateLoading')}</div>}
      {isPlanDialog && templateError && <div role="alert" aria-live="assertive" className="name-dialog-template__error">{t('dialog.templateErrorPrefix')}: {templateError}</div>}
      <Input
        aria-label={inputLabel}
        placeholder={inputPlaceholder}
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          setSubmitError(null)
        }}
        onPressEnter={() => void submit()}
        autoFocus
      />
      {templateConfigured && (
        <div className="name-dialog-template__preview" aria-live="polite">
          <span>{t('dialog.templatePreview')}</span>
          <output>{preview || (value.trim() ? t('dialog.templatePreviewInvalid') : t('dialog.templatePreviewEmpty'))}</output>
        </div>
      )}
      {submitError && <div role="alert" aria-live="assertive" className="name-dialog-template__error">{submitError}</div>}
      {isPlanDialog && templateError && (
        <Button size="small" onClick={() => setLoadSequence((sequence) => sequence + 1)}>
          {t('dialog.templateRetry')}
        </Button>
      )}
    </Modal>
  )
}

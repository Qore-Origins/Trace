import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tooltip } from 'antd'
import { ERR, TraceError } from '@shared/errors'
import { formatPlanNameTemplate, validatePlanNameTemplate } from '@shared/plan-name-templates'
import type { PlanNameTemplateSettings } from '@shared/plan-name-templates'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { ClientError, invoke } from '../ipc-client'
import { useTranslation } from '../i18n'
import { useAppStore } from '../stores/app-store'

interface PlanNameTemplateSettingsProps {
  active?: boolean
}

interface TemplateFolder {
  path: string
  kind: PlanTreeNode['kind'] | 'root'
}

const EMPTY_SETTINGS: PlanNameTemplateSettings = { rules: [], disabled_default_paths: [] }

async function loadFolders(): Promise<TemplateFolder[]> {
  const folders: TemplateFolder[] = [{ path: '', kind: 'root' }]
  const pendingParents = ['']
  const visitedParents = new Set<string>()

  while (pendingParents.length > 0) {
    const parentPath = pendingParents.shift()
    if (parentPath === undefined || visitedParents.has(parentPath)) continue
    visitedParents.add(parentPath)

    const children = await invoke('storage:treeGetChildren', { parent_path: parentPath })
    for (const child of children) {
      folders.push({ path: child.path, kind: child.kind })
      if (child.has_children) pendingParents.push(child.path)
    }
  }

  return folders
}

function templateErrorMessage(
  error: unknown,
  fallbackKey: 'settings.templateLoadFailed' | 'settings.templateSaveFailed' | 'settings.templateRemoveFailed',
  t: (key: string) => string
): string {
  const code = error instanceof ClientError || error instanceof TraceError ? error.code : undefined
  if (code === ERR.VALIDATION) return t('settings.templateValidationFailed')
  return t(fallbackKey)
}

export default function PlanNameTemplateSettingsPanel({ active = true }: PlanNameTemplateSettingsProps): React.JSX.Element {
  const { t } = useTranslation()
  const rootDir = useAppStore((state) => state.rootDir)
  const generationRef = useRef(0)
  const [settings, setSettings] = useState<PlanNameTemplateSettings>(EMPTY_SETTINGS)
  const [folders, setFolders] = useState<TemplateFolder[]>([])
  const [selectedPath, setSelectedPath] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const generation = ++generationRef.current
    if (!active || !rootDir) {
      setSettings(EMPTY_SETTINGS)
      setFolders([])
      setSelectedPath('')
      setDraft('')
      setLoading(false)
      setSaving(false)
      setRemoving(false)
      setError(null)
      return () => {
        if (generationRef.current === generation) generationRef.current += 1
      }
    }

    setSettings(EMPTY_SETTINGS)
    setFolders([])
    setSelectedPath('')
    setDraft('')
    setError(null)
    setLoading(true)
    setSaving(false)
    setRemoving(false)
    const isCurrent = (): boolean =>
      generationRef.current === generation &&
      useAppStore.getState().rootDir === rootDir

    void Promise.all([invoke('plan-template:get'), loadFolders()])
      .then(([nextSettings, nextFolders]) => {
        if (!isCurrent()) return
        setSettings(nextSettings)
        setFolders(nextFolders)
      })
      .catch((loadError: unknown) => {
        if (!isCurrent()) return
        setError(templateErrorMessage(loadError, 'settings.templateLoadFailed', t))
      })
      .finally(() => {
        if (isCurrent()) setLoading(false)
      })

    return () => {
      if (generationRef.current === generation) generationRef.current += 1
    }
  }, [active, rootDir, t])

  const selectedRule = settings.rules.find((rule) => rule.parent_path === selectedPath)
  const description = t('settings.templateDescription')
  let preview = ''
  if (draft.trim()) {
    try {
      preview = formatPlanNameTemplate(draft, t('settings.templateExampleTitle'))
    } catch {
      preview = ''
    }
  }

  const saveTemplate = async (): Promise<void> => {
    const rootAtStart = rootDir
    const generation = generationRef.current
    if (!active || !rootAtStart) return
    setError(null)
    try {
      validatePlanNameTemplate(draft)
      setSaving(true)
      const nextSettings = await invoke('plan-template:set', { parent_path: selectedPath, template: draft })
      if (generationRef.current !== generation || useAppStore.getState().rootDir !== rootAtStart) return
      setSettings(nextSettings)
    } catch (saveError) {
      if (generationRef.current === generation && useAppStore.getState().rootDir === rootAtStart) {
        setError(templateErrorMessage(saveError, 'settings.templateSaveFailed', t))
      }
    } finally {
      if (generationRef.current === generation && useAppStore.getState().rootDir === rootAtStart) setSaving(false)
    }
  }

  const removeTemplate = async (): Promise<void> => {
    const rootAtStart = rootDir
    const generation = generationRef.current
    if (!active || !rootAtStart || !selectedRule) return
    setError(null)
    setRemoving(true)
    try {
      const nextSettings = await invoke('plan-template:remove', { parent_path: selectedPath })
      if (generationRef.current !== generation || useAppStore.getState().rootDir !== rootAtStart) return
      setSettings(nextSettings)
      setDraft('')
    } catch (removeError) {
      if (generationRef.current === generation && useAppStore.getState().rootDir === rootAtStart) {
        setError(templateErrorMessage(removeError, 'settings.templateRemoveFailed', t))
      }
    } finally {
      if (generationRef.current === generation && useAppStore.getState().rootDir === rootAtStart) setRemoving(false)
    }
  }

  const chooseFolder = (path: string): void => {
    setSelectedPath(path)
    setDraft(settings.rules.find((rule) => rule.parent_path === path)?.template ?? '')
    setError(null)
  }

  return (
    <section className="plan-name-template-settings" aria-label={t('settings.templateTitle')}>
      <div className="plan-name-template-settings__field">
        <Tooltip title={description} mouseEnterDelay={2}>
          <label className="plan-name-template-settings__label" htmlFor="plan-name-template-folder" tabIndex={0} data-template-description="true">
            {t('settings.templateFolder')}
          </label>
        </Tooltip>
        <select
          id="plan-name-template-folder"
          aria-label={t('settings.templateFolder')}
          value={selectedPath}
          disabled={loading || folders.length === 0}
          onChange={(event) => chooseFolder(event.target.value)}
        >
          {folders.map((folder) => (
            <option key={folder.path || '__root__'} value={folder.path}>
              {folder.kind === 'root' ? t('settings.templateRoot') : folder.path}
            </option>
          ))}
        </select>
      </div>
      <div className="plan-name-template-settings__field">
        <Tooltip title={description} mouseEnterDelay={2}>
          <label className="plan-name-template-settings__label" htmlFor="plan-name-template-value" tabIndex={0}>
            {t('settings.templateInput')}
          </label>
        </Tooltip>
        <Input
          id="plan-name-template-value"
          aria-label={t('settings.templateInput')}
          value={draft}
          placeholder={t('settings.templatePlaceholder')}
          disabled={loading || folders.length === 0}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
        />
      </div>
      <div className="plan-name-template-settings__preview" aria-live="polite">
        <span>{t('settings.templatePreview')}</span>
        <output>{preview || t('settings.templatePreviewEmpty')}</output>
      </div>
      <div className="plan-name-template-settings__actions">
        <Button size="small" type="primary" loading={saving} disabled={loading || folders.length === 0} onClick={() => void saveTemplate()}>
          {t('settings.templateSave')}
        </Button>
        {selectedRule && (
          <Button size="small" danger loading={removing} disabled={loading || saving} onClick={() => void removeTemplate()}>
            {t('settings.templateRemove')}
          </Button>
        )}
      </div>
      {loading && <div role="status" aria-live="polite" className="plan-name-template-settings__status">{t('settings.templateLoading')}</div>}
      {error && <div role="alert" aria-live="assertive" className="plan-name-template-settings__error">{t('settings.templateErrorPrefix')}: {error}</div>}
      {!loading && folders.length === 0 && !error && <div role="status">{t('settings.templateNoFolders')}</div>}
      {selectedRule?.source === 'default' && <div className="plan-name-template-settings__source">{t('settings.templateDefault')}</div>}
      {selectedRule?.source === 'custom' && <div className="plan-name-template-settings__source">{t('settings.templateCustom')}</div>}
    </section>
  )
}

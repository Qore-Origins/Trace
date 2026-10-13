import { useEffect, useRef, useState } from 'react'
import SettingHelp from './ui/SettingHelp'
import { Button, Input, Select, Switch } from 'antd'
import type {
  PlanWorkflowConfig, WorkflowContentComponentTemplate, WorkflowContentTemplate,
  WorkflowNameRule, WorkflowOutput, WorkflowPreset, WorkflowScope
} from '@shared/plan-workflow-types'
import { invoke } from '../ipc-client'
import { useTranslation } from '../i18n'
import { useAppStore } from '../stores/app-store'

const emptyConfig = (): PlanWorkflowConfig => ({ format_version: '1', name_rules: [], content_templates: [], presets: [] })
const newId = (prefix: string): string => `${prefix}_${crypto.randomUUID().slice(0, 8)}`

function newOutput(contentTemplateId: string): WorkflowOutput {
  return { id: newId('output'), destination: { kind: 'selected' }, name_template_mode: 'inherit',
    content_template_id: contentTemplateId, repeat: 'once', workflow_kind: 'regular' }
}

function newPreset(contentTemplateId: string, name: string): WorkflowPreset {
  return { id: newId('preset'), name, scope: { kind: 'global' }, enabled: false,
    is_default: false, outputs: [newOutput(contentTemplateId)] }
}

function uniquePresetName(base: string, presets: readonly WorkflowPreset[]): string {
  const names = new Set(presets.map((preset) => preset.name))
  if (!names.has(base)) return base
  let number = 2
  while (names.has(`${base} (${number})`)) number += 1
  return `${base} (${number})`
}

function newContentTemplate(): WorkflowContentTemplate {
  return { id: newId('content'), name: '新内容模板', components: [{ type: 'heading', title: '目标' }, { type: 'task_list', title: '任务' }] }
}

interface Props { active: boolean }

export default function PlanWorkflowSettings({ active }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const rootDir = useAppStore((state) => state.rootDir)
  const generationRef = useRef(0)
  const [libraryId, setLibraryId] = useState<string | null>(null)
  const [config, setConfig] = useState<PlanWorkflowConfig>(emptyConfig)
  const [suggestions, setSuggestions] = useState<PlanWorkflowConfig>(emptyConfig)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null)
  const [editingSection, setEditingSection] = useState<'preset' | 'content' | 'rules' | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const generation = ++generationRef.current
    setLibraryId(null)
    setConfig(emptyConfig())
    setSuggestions(emptyConfig())
    setSelectedPresetId(null)
    setSelectedContentId(null)
    setEditingSection(null)
    setDirty(false)
    setError(null)
    if (!active || !rootDir) return () => { generationRef.current += 1 }
    setBusy(true)
    void invoke('plan-workflow:list').then((result) => {
      if (generationRef.current !== generation || useAppStore.getState().rootDir !== rootDir) return
      setLibraryId(result.library_id)
      setConfig(result.config)
      setSuggestions(result.suggestions)
      setSelectedPresetId(null)
      setSelectedContentId(result.config.content_templates[0]?.id ?? null)
    }).catch((cause: unknown) => {
      if (generationRef.current === generation) setError(cause instanceof Error ? cause.message : t('workflow.loadFailed'))
    }).finally(() => {
      if (generationRef.current === generation) setBusy(false)
    })
    return () => { if (generationRef.current === generation) generationRef.current += 1 }
  }, [active, rootDir, t])

  const change = (update: (current: PlanWorkflowConfig) => PlanWorkflowConfig): void => {
    setConfig(update)
    setDirty(true)
    setError(null)
  }
  const selectedPreset = config.presets.find((preset) => preset.id === selectedPresetId)
  const selectedContent = config.content_templates.find((template) => template.id === selectedContentId)

  const updatePreset = (update: (preset: WorkflowPreset) => WorkflowPreset): void => {
    if (!selectedPresetId) return
    change((current) => ({ ...current, presets: current.presets.map((preset) => preset.id === selectedPresetId ? update(preset) : preset) }))
  }
  const updateOutput = (outputId: string, update: (output: WorkflowOutput) => WorkflowOutput): void => {
    updatePreset((preset) => ({ ...preset, outputs: preset.outputs.map((output) => output.id === outputId ? update(output) : output) }))
  }
  const updateContent = (update: (template: WorkflowContentTemplate) => WorkflowContentTemplate): void => {
    if (!selectedContentId) return
    change((current) => ({ ...current, content_templates: current.content_templates.map((template) =>
      template.id === selectedContentId ? update(template) : template) }))
  }

  const save = async (): Promise<void> => {
    if (!libraryId || busy) return
    const generation = generationRef.current
    setBusy(true)
    setError(null)
    try {
      const saved = await invoke('plan-workflow:save', { library_id: libraryId, config })
      if (generation !== generationRef.current) return
      setConfig(saved)
      setDirty(false)
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : t('workflow.saveFailed'))
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }

  const addSuggestion = (suggestion: WorkflowPreset): void => {
    const copiedId = newId('preset')
    const copiedName = uniquePresetName(`${suggestion.name} ${t('workflow.copySuffix')}`, config.presets)
    change((current) => ({
      ...current,
      content_templates: [...current.content_templates, ...suggestions.content_templates.filter((template) =>
        suggestion.outputs.some((output) => output.content_template_id === template.id) &&
        !current.content_templates.some((existing) => existing.id === template.id))],
      presets: [...current.presets, { ...structuredClone(suggestion), id: copiedId, name: copiedName, enabled: false, is_default: false }]
    }))
    setSelectedPresetId(copiedId)
    setEditingSection('preset')
  }

  const deletePreset = async (): Promise<void> => {
    if (!libraryId || !selectedPreset || busy) return
    if (dirty) { setError(t('workflow.saveBeforeDelete')); return }
    const generation = generationRef.current
    setBusy(true)
    try {
      const saved = await invoke('plan-workflow:remove', { library_id: libraryId, preset_id: selectedPreset.id })
      if (generation !== generationRef.current) return
      setConfig(saved)
      setSelectedPresetId(null)
      setEditingSection(null)
    } catch (cause) {
      if (generation === generationRef.current) setError(cause instanceof Error ? cause.message : t('workflow.saveFailed'))
    } finally {
      if (generation === generationRef.current) setBusy(false)
    }
  }

  const scopeFields = (scope: WorkflowScope, onChange: (scope: WorkflowScope) => void): React.JSX.Element => (
    <div className="plan-workflow-settings__field-row">
      <Select aria-label={t('workflow.scope')} value={scope.kind} options={[
        { value: 'directory', label: t('workflow.scopeDirectory') },
        { value: 'category', label: t('workflow.scopeCategory') },
        { value: 'global', label: t('workflow.scopeGlobal') }
      ]} onChange={(kind: WorkflowScope['kind']) => onChange(kind === 'global' ? { kind } : { kind, path: '' })} />
      {scope.kind !== 'global' && <Input aria-label={t('workflow.scopePath')} value={scope.path}
        placeholder={t('workflow.scopePath')} onChange={(event) => onChange({ ...scope, path: event.target.value })} />}
    </div>
  )

  return <div className="plan-workflow-settings">
    {busy && <div role="status">{t('common.loading')}</div>}
    {error && <div role="alert" className="plan-workflow-settings__error">{error}</div>}
    {!libraryId && !busy && !error && <div role="status">{t('settings.notConfigured')}</div>}
    {libraryId && <>
      {editingSection === null && <>
        <section>
          <h3>{t('workflow.presets')}</h3>
          <SettingHelp topic="workflowPresets" />
          <div className="plan-workflow-settings__field-row">
            <Button onClick={() => {
              const template = config.content_templates[0] ?? newContentTemplate()
              const preset = newPreset(template.id, uniquePresetName(t('workflow.newPresetName'), config.presets))
              change((current) => ({ ...current, content_templates: current.content_templates.length ? current.content_templates : [template], presets: [...current.presets, preset] }))
              setSelectedPresetId(preset.id)
              setSelectedContentId(template.id)
              setEditingSection('preset')
            }}>{t('workflow.newPreset')}</Button>
            <Select aria-label={t('workflow.suggestions')} placeholder={t('workflow.suggestions')}
              className="plan-workflow-settings__select" value={null}
              options={suggestions.presets.map((preset) => ({ value: preset.id, label: preset.name }))}
              onChange={(id: string) => { const found = suggestions.presets.find((preset) => preset.id === id); if (found) addSuggestion(found) }} />
          </div>
          {config.presets.length === 0 && <p>{t('workflow.noPresets')}</p>}
          <div className="plan-workflow-settings__overview-list">
            {config.presets.map((preset) => <div className="plan-workflow-settings__overview-card" key={preset.id}>
              <div className="plan-workflow-settings__overview-info">
                <strong>{preset.name}</strong>
                <span>{t(`workflow.scope${preset.scope.kind === 'directory' ? 'Directory' : preset.scope.kind === 'category' ? 'Category' : 'Global'}`)}{preset.scope.kind === 'global' ? '' : ` · ${preset.scope.path}`}</span>
                <span>{t('workflow.outputCount', { count: preset.outputs.length })}</span>
              </div>
              <div className="plan-workflow-settings__overview-actions">
                <span>{t(preset.enabled ? 'workflow.enabled' : 'workflow.disabled')}{preset.is_default ? ` · ${t('workflow.defaultShort')}` : ''}</span>
                <Button size="small" onClick={() => { setSelectedPresetId(preset.id); setEditingSection('preset') }}>{t('workflow.editPreset')}</Button>
              </div>
            </div>)}
          </div>
        </section>
        <section className="plan-workflow-settings__overview-section">
          <div><h3>{t('workflow.contentTemplates')}</h3><span>{t('workflow.templateCount', { count: config.content_templates.length })}</span></div>
          <Button size="small" onClick={() => setEditingSection('content')}>{t('workflow.manage')}</Button>
        </section>
        <section className="plan-workflow-settings__overview-section">
          <div><h3>{t('workflow.nameRules')}</h3><span>{t('workflow.ruleCount', { count: config.name_rules.length })}</span></div>
          <Button size="small" onClick={() => setEditingSection('rules')}>{t('workflow.manage')}</Button>
        </section>
      </>}
      {editingSection !== null && <div className="plan-workflow-settings__editor-heading">
        <Button size="small" onClick={() => setEditingSection(null)}>{t('workflow.backToOverview')}</Button>
        <strong>{editingSection === 'preset' ? selectedPreset?.name : t(editingSection === 'content' ? 'workflow.contentTemplates' : 'workflow.nameRules')}</strong>
        <Button type="primary" size="small" disabled={!dirty || busy} loading={busy} onClick={() => void save()}>{t('workflow.save')}</Button>
        {dirty && <span role="status">{t('workflow.unsaved')}</span>}
      </div>}
      {editingSection === 'preset' && selectedPreset && <section>
        <h3>{t('workflow.presets')}</h3>
        <SettingHelp topic="workflowPresets" />
        <div className="plan-workflow-settings__field-row">
          <Button onClick={() => addSuggestion(selectedPreset)}>{t('workflow.copyPreset')}</Button>
          <Button danger disabled={busy} onClick={() => void deletePreset()}>{t('workflow.deletePreset')}</Button>
        </div>
        {selectedPreset && <div className="plan-workflow-settings__card">
          <label>{t('workflow.presetName')}<Input aria-label={t('workflow.presetName')} value={selectedPreset.name} onChange={(event) => updatePreset((preset) => ({ ...preset, name: event.target.value }))} /></label>
          <label>{t('workflow.scope')}{scopeFields(selectedPreset.scope, (scope) => updatePreset((preset) => ({ ...preset, scope })) )}</label>
          <div className="plan-workflow-settings__field-row">
            <label>{t('workflow.enabled')} <Switch checked={selectedPreset.enabled} onChange={(enabled) => updatePreset((preset) => ({ ...preset, enabled }))} /></label>
            <label>{t('workflow.default')} <Switch checked={selectedPreset.is_default} onChange={(isDefault) => updatePreset((preset) => ({ ...preset, is_default: isDefault }))} /></label>
          </div>
          <h4>{t('workflow.outputs')}</h4>
          <SettingHelp topic="workflowOutputs" />
          {selectedPreset.outputs.map((output) => <div className="plan-workflow-settings__card" key={output.id}>
            <div className="plan-workflow-settings__field-row"><strong>{output.id}</strong>
              <Button danger size="small" disabled={selectedPreset.outputs.length === 1}
                onClick={() => updatePreset((preset) => ({ ...preset, outputs: preset.outputs.filter((item) => item.id !== output.id) }))}>{t('workflow.remove')}</Button></div>
            <div className="plan-workflow-settings__field-row">
              <label>{t('workflow.kind')}<Select value={output.workflow_kind ?? 'regular'} options={['regular', 'week', 'day'].map((value) => ({ value, label: t(`workflow.kind_${value}`) }))}
                onChange={(workflow_kind: NonNullable<WorkflowOutput['workflow_kind']>) => updateOutput(output.id, (item) => ({ ...item, workflow_kind }))} /></label>
              <label>{t('workflow.repeat')}<Select value={output.repeat} options={['once', 'each_day'].map((value) => ({ value, label: t(`workflow.repeat_${value}`) }))}
                onChange={(repeat: WorkflowOutput['repeat']) => updateOutput(output.id, (item) => ({ ...item, repeat }))} /></label>
              <label>{t('workflow.contentTemplate')}<Select value={output.content_template_id} options={config.content_templates.map((template) => ({ value: template.id, label: template.name }))}
                onChange={(content_template_id: string) => updateOutput(output.id, (item) => ({ ...item, content_template_id }))} /></label>
            </div>
            <div className="plan-workflow-settings__field-row">
              <label>{t('workflow.destination')}<Select value={output.destination.kind} options={[{ value: 'selected', label: t('workflow.destinationSelected') }, { value: 'fixed', label: t('workflow.destinationFixed') }]}
                onChange={(kind: 'selected' | 'fixed') => updateOutput(output.id, (item) => ({ ...item, destination: kind === 'selected' ? { kind } : { kind, path: '' } }))} /></label>
              {output.destination.kind === 'fixed' && <Input aria-label={t('workflow.destinationPath')} value={output.destination.path} placeholder={t('workflow.destinationPath')}
                onChange={(event) => updateOutput(output.id, (item) => ({ ...item, destination: { kind: 'fixed', path: event.target.value } }))} />}
            </div>
            <div className="plan-workflow-settings__field-row">
              <label>{t('workflow.nameMode')}<Select value={output.name_template_mode} options={[{ value: 'inherit', label: t('workflow.inherit') }, { value: 'explicit', label: t('workflow.explicit') }]}
                onChange={(name_template_mode: WorkflowOutput['name_template_mode']) => updateOutput(output.id, (item) => name_template_mode === 'inherit'
                  ? { ...item, name_template_mode, name_template: undefined } : { ...item, name_template_mode, name_template: '{this.folder_name}_{date}_{title}' })} /></label>
              {output.name_template_mode === 'explicit' && <Input aria-label={t('workflow.nameTemplate')} value={output.name_template ?? ''}
                onChange={(event) => updateOutput(output.id, (item) => ({ ...item, name_template: event.target.value }))} />}
            </div>
          </div>)}
          <Button size="small" onClick={() => updatePreset((preset) => ({ ...preset, outputs: [...preset.outputs, newOutput(config.content_templates[0]?.id ?? '')] }))}>{t('workflow.addOutput')}</Button>
        </div>}
      </section>}
      {editingSection === 'content' && <section>
        <h3>{t('workflow.contentTemplates')}</h3>
        <SettingHelp topic="workflowContent" />
        <div className="plan-workflow-settings__field-row"><Select aria-label={t('workflow.contentTemplates')} className="plan-workflow-settings__select" value={selectedContentId}
          options={config.content_templates.map((template) => ({ value: template.id, label: template.name }))} onChange={setSelectedContentId} />
          <Button onClick={() => { const template = newContentTemplate(); change((current) => ({ ...current, content_templates: [...current.content_templates, template] })); setSelectedContentId(template.id) }}>{t('workflow.newContent')}</Button>
          <Button danger disabled={!selectedContent || config.presets.some((preset) => preset.outputs.some((output) => output.content_template_id === selectedContentId))}
            onClick={() => { change((current) => ({ ...current, content_templates: current.content_templates.filter((template) => template.id !== selectedContentId) })); setSelectedContentId(null) }}>{t('workflow.remove')}</Button>
        </div>
        {selectedContent && <div className="plan-workflow-settings__card">
          <label>{t('workflow.contentName')}<Input value={selectedContent.name} onChange={(event) => updateContent((template) => ({ ...template, name: event.target.value }))} /></label>
          {selectedContent.components.map((component, index) => <div className="plan-workflow-settings__card" key={`${selectedContent.id}:${index}`}><div className="plan-workflow-settings__field-row">
            <Select aria-label={t('workflow.componentType')} value={component.type} options={['heading', 'note', 'task_list', 'mood', 'plan_reference'].map((type) => ({ value: type, label: t(`workflow.component_${type}`) }))}
              onChange={(type: WorkflowContentComponentTemplate['type']) => updateContent((template) => ({ ...template, components: template.components.map((item, position) => position === index ? { type, title: item.title, ...(type === 'plan_reference' ? { reference_output_key: '' } : {}) } : item) }))} />
            <Input aria-label={t('workflow.componentTitle')} value={component.title} onChange={(event) => updateContent((template) => ({ ...template, components: template.components.map((item, position) => position === index ? { ...item, title: event.target.value } : item) }))} />
            {component.type === 'plan_reference' && <Input aria-label={t('workflow.referenceOutput')} value={component.reference_output_key ?? ''} onChange={(event) => updateContent((template) => ({ ...template, components: template.components.map((item, position) => position === index ? { ...item, reference_output_key: event.target.value } : item) }))} />}
            <Button size="small" disabled={index === 0} onClick={() => updateContent((template) => { const components = [...template.components]; [components[index - 1], components[index]] = [components[index], components[index - 1]]; return { ...template, components } })}>{t('workflow.up')}</Button>
            <Button size="small" disabled={index === selectedContent.components.length - 1} onClick={() => updateContent((template) => { const components = [...template.components]; [components[index], components[index + 1]] = [components[index + 1], components[index]]; return { ...template, components } })}>{t('workflow.down')}</Button>
            <Button size="small" danger onClick={() => updateContent((template) => ({ ...template, components: template.components.filter((_item, position) => position !== index) }))}>{t('workflow.remove')}</Button>
          </div>
            {(component.type === 'note' || component.type === 'mood') && <Input.TextArea aria-label={t('workflow.componentPrompt')} value={component.prompt ?? ''}
              onChange={(event) => updateContent((template) => ({ ...template, components: template.components.map((item, position) => position === index ? { ...item, prompt: event.target.value } : item) }))} />}
          </div>)}
          <Button size="small" onClick={() => updateContent((template) => ({ ...template, components: [...template.components, { type: 'note', title: '记录' }] }))}>{t('workflow.addComponent')}</Button>
        </div>}
      </section>}
      {editingSection === 'rules' && <section>
        <h3>{t('workflow.nameRules')}</h3>
        <SettingHelp topic="workflowNameRules" />
        {config.name_rules.map((rule) => <div className="plan-workflow-settings__field-row" key={rule.id}>
          <Switch aria-label={t('workflow.enabled')} checked={rule.enabled} onChange={(enabled) => change((current) => ({ ...current, name_rules: current.name_rules.map((item) => item.id === rule.id ? { ...item, enabled } : item) }))} />
          <Select aria-label={t('workflow.scope')} value={rule.scope.kind} options={[{ value: 'global', label: t('workflow.scopeGlobal') }, { value: 'category', label: t('workflow.scopeCategory') }]}
            onChange={(kind: WorkflowNameRule['scope']['kind']) => change((current) => ({ ...current, name_rules: current.name_rules.map((item) => item.id === rule.id ? { ...item, scope: kind === 'global' ? { kind } : { kind, path: '' } } : item) }))} />
          {rule.scope.kind === 'category' && <Input aria-label={t('workflow.scopePath')} value={rule.scope.path} onChange={(event) => change((current) => ({ ...current, name_rules: current.name_rules.map((item) => item.id === rule.id ? { ...item, scope: { kind: 'category', path: event.target.value } } : item) }))} />}
          <Input aria-label={t('workflow.nameTemplate')} value={rule.template} onChange={(event) => change((current) => ({ ...current, name_rules: current.name_rules.map((item) => item.id === rule.id ? { ...item, template: event.target.value } : item) }))} />
          <Button danger size="small" onClick={() => change((current) => ({ ...current, name_rules: current.name_rules.filter((item) => item.id !== rule.id) }))}>{t('workflow.remove')}</Button>
        </div>)}
        <Button size="small" onClick={() => change((current) => ({ ...current, name_rules: [...current.name_rules, { id: newId('rule'), scope: { kind: 'global' }, enabled: false, template: '{this.folder_name}_{date}_{title}' }] }))}>{t('workflow.addNameRule')}</Button>
      </section>}
      {editingSection === null && dirty && <div className="plan-workflow-settings__actions"><Button type="primary" disabled={busy} loading={busy} onClick={() => void save()}>{t('workflow.save')}</Button>
        {dirty && <span role="status">{t('workflow.unsaved')}</span>}</div>
      }
    </>}
  </div>
}

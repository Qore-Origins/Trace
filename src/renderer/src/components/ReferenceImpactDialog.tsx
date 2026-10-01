import { useEffect, useMemo, useState } from 'react'
import { Radio, Select, Typography } from 'antd'
import type {
  PlanReferenceCandidate, ReferenceImpactDecision, ReferenceImpactItem,
  ReferenceImpactPreview
} from '@shared/ipc-contract'
import { referenceComponentTypeFallback } from '@shared/plan-reference-types'
import { getMessage, getModal } from '../antd-host'
import { i18n, useTranslation } from '../i18n'
import { invoke } from '../ipc-client'

type ImpactChoice = { rename_action: 'update' | 'keep' } | { decisions: ReferenceImpactDecision[] }

function referenceKey(reference: Pick<ReferenceImpactItem, 'source_path' | 'source_component_id'>): string {
  return `${reference.source_path}\0${reference.source_component_id}`
}

function ReferenceImpactChoices(props: {
  preview: ReferenceImpactPreview
  libraryId: string
  onChange: (choice: ImpactChoice | null) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [renameAction, setRenameAction] = useState<'update' | 'keep' | null>(null)
  const [decisions, setDecisions] = useState<Record<string, ReferenceImpactDecision>>({})
  const [targets, setTargets] = useState<PlanReferenceCandidate[]>([])
  const [query, setQuery] = useState('')
  const isRename = props.preview.operation.startsWith('rename-')

  useEffect(() => {
    if (isRename) {
      props.onChange(renameAction ? { rename_action: renameAction } : null)
      return
    }
    const chosen = props.preview.references.map((reference) => decisions[referenceKey(reference)])
    props.onChange(chosen.every((decision) =>
      decision && (decision.action === 'keep' || decision.replacement))
      ? { decisions: chosen as ReferenceImpactDecision[] } : null)
  }, [decisions, isRename, props, renameAction])

  useEffect(() => {
    if (!query.trim()) { setTargets([]); return }
    let active = true
    void invoke('plan-reference:search', { library_id: props.libraryId, query: query.trim() })
      .then((result) => { if (active) setTargets(result.targets) })
      .catch(() => { if (active) setTargets([]) })
    return () => { active = false }
  }, [props.libraryId, query])

  const targetOptions = useMemo(() => targets.map((target) => ({
    value: JSON.stringify([target.path, target.component_id ?? null]),
    label: target.component_id
      ? `${target.plan_name} / ${target.component_type &&
        target.component_name === referenceComponentTypeFallback(target.component_type)
          ? referenceComponentTypeFallback(target.component_type, props.preview.locale)
          : target.component_name ?? target.component_type ?? ''}`
      : target.plan_name,
    target
  })), [props.preview.locale, targets])

  return <div style={{ display: 'grid', gap: 12, maxHeight: '55vh', overflowY: 'auto' }}>
    <Typography.Paragraph>{t('references.impactDescription', { count: props.preview.references.length })}</Typography.Paragraph>
    {isRename ? <Radio.Group
      aria-label={t('references.impactChoice')}
      value={renameAction}
      onChange={(event) => setRenameAction(event.target.value as 'update' | 'keep')}
      options={[
        { label: t('references.impactUpdate'), value: 'update' },
        { label: t('references.impactKeepDisplay'), value: 'keep' }
      ]}
    /> : props.preview.references.map((reference) => {
      const key = referenceKey(reference)
      const selected = decisions[key]
      const options = targetOptions.filter((option) => reference.mode === 'link' || option.target.component_id)
      return <div key={key} style={{ display: 'grid', gap: 8 }}>
        <Typography.Text strong>{reference.source_path} · {reference.target_name_snapshot}</Typography.Text>
        <Radio.Group aria-label={`${reference.source_path} ${t('references.impactChoice')}`}
          value={selected?.action}
          onChange={(event) => {
            const action = event.target.value as 'keep' | 'replace'
            setDecisions((previous) => ({ ...previous, [key]: {
              source_path: reference.source_path, source_component_id: reference.source_component_id,
              action
            } }))
          }}
          options={[
            { label: t('references.impactReplace'), value: 'replace' },
            { label: t('references.impactKeepBroken'), value: 'keep' }
          ]}
        />
        {selected?.action === 'replace' && <Select
          showSearch filterOption={false} showArrow={false}
          aria-label={`${reference.source_path} ${t('references.impactReplacement')}`}
          placeholder={t('references.searchPlaceholder')}
          onSearch={setQuery}
          options={options}
          onChange={(value: string) => {
            const target = options.find((option) => option.value === value)?.target
            if (!target) return
            setDecisions((previous) => ({ ...previous, [key]: {
              source_path: reference.source_path, source_component_id: reference.source_component_id,
              action: 'replace', replacement: {
                path: target.path, ...(target.component_id ? { component_id: target.component_id } : {})
              }
            } }))
          }}
        />}
      </div>
    })}
  </div>
}

export function requestReferenceImpactDecision(
  preview: ReferenceImpactPreview,
  libraryId: string
): Promise<ImpactChoice | null> {
  if (preview.references.length === 0) {
    return Promise.resolve(preview.operation.startsWith('rename-')
      ? { rename_action: 'update' } : { decisions: [] })
  }
  return new Promise((resolve) => {
    let choice: ImpactChoice | null = null
    let settled = false
    const finish = (value: ImpactChoice | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    getModal().confirm({
      title: i18n.t('references.impactTitle'),
      content: <ReferenceImpactChoices preview={preview} libraryId={libraryId} onChange={(value) => { choice = value }} />,
      okText: i18n.t('references.impactConfirm'), cancelText: i18n.t('common.cancel'),
      autoFocusButton: 'cancel',
      onOk: () => {
        if (!choice) {
          getMessage().warning(i18n.t('references.impactChooseAll'))
          return Promise.reject(new Error('incomplete reference choices'))
        }
        finish(choice)
      },
      onCancel: () => finish(null),
      afterClose: () => finish(null)
    })
  })
}

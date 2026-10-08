import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import type { AgentTargetSelection } from '@shared/agent-types'
import type { PlanTreeNode } from '@shared/ipc-contract'
import type { TrashEntry } from '@shared/trash-types'
import { invoke } from '../../ipc-client'
import { useTranslation } from '../../i18n'

export function targetKey(target: AgentTargetSelection): string {
  return target.kind === 'trash' ? `trash:${target.entryId}` : `${target.kind}:${target.path}`
}

export default function AgentTargetPicker({ selected, onChange, onClose }: {
  selected: AgentTargetSelection[]
  onChange: (targets: AgentTargetSelection[]) => void
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [nodes, setNodes] = useState<PlanTreeNode[]>([])
  const [trash, setTrash] = useState<TrashEntry[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const browse = async (parentPath: string, recycled = false): Promise<void> => {
    const current = ++epoch.current
    setLoading(true); setError(''); setPath(parentPath); setShowTrash(recycled)
    try {
      if (recycled) {
        const result = await invoke('trash:list')
        if (current === epoch.current) setTrash(result)
      } else {
        const result = await invoke('agent:context:browse', { parentPath })
        if (current === epoch.current) setNodes(result.filter((node) => !/^diary(?:\/|$)/i.test(node.path)))
      }
    } catch {
      if (current === epoch.current) setError(t('agentChat.targetFailed'))
    } finally {
      if (current === epoch.current) setLoading(false)
    }
  }
  useEffect(() => { void browse(''); return () => { epoch.current += 1 } }, [])
  const toggle = (target: AgentTargetSelection): void => {
    const key = targetKey(target)
    onChange(selected.some((item) => targetKey(item) === key)
      ? selected.filter((item) => targetKey(item) !== key)
      : [...selected, target])
  }
  const matches = (value: string): boolean => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())
  return (
    <Modal open title={t('agentChat.targetTitle')} onCancel={onClose}
      footer={<Button onClick={onClose}>{t('agentChat.done')}</Button>}>
      <div className="agent-context-picker agent-target-picker">
        <p className="agent-hint">{t('agentChat.targetHint')}</p>
        <header>
          <Button onClick={() => void browse('')}>{t('agentChat.browseRoot')}</Button>
          <Button onClick={() => void browse('', true)}>{t('agentChat.trash')}</Button>
          <Button disabled={!path || showTrash || loading} onClick={() => void browse(path.split('/').slice(0, -1).join('/'))}>{t('agentChat.up')}</Button>
        </header>
        <label>{t('agentChat.searchTargets')}<input aria-label={t('agentChat.searchTargets')} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <p>{showTrash ? t('agentChat.trash') : path || t('agentChat.browseRoot')}</p>
        {loading && <p role="status">{t('common.loading')}</p>}
        {error && <p role="alert">{error}<Button onClick={() => void browse(path, showTrash)}>{t('agentChat.retry')}</Button></p>}
        {!loading && <ul className="agent-context-list">
          {showTrash ? trash.filter((entry) => matches(entry.name)).map((entry) => {
            const target: AgentTargetSelection = { kind: 'trash', entryId: entry.id }
            return <li key={entry.id}><label><input type="checkbox" aria-label={t('agentChat.selectTarget', { path: entry.name })}
              checked={selected.some((item) => targetKey(item) === targetKey(target))} onChange={() => toggle(target)} />
              {entry.name} · {t(`agentChat.${entry.kind === 'folder' ? 'targetFolder' : 'plan'}`)} · {entry.original_relative_path}</label></li>
          }) : nodes.filter((node) => matches(node.path)).map((node) => {
            const target: AgentTargetSelection = { kind: node.kind === 'plan' ? 'plan' : 'folder', path: node.path }
            return <li key={node.path}><label><input type="checkbox" aria-label={t('agentChat.selectTarget', { path: node.path })}
              checked={selected.some((item) => targetKey(item) === targetKey(target))} onChange={() => toggle(target)} />
              {node.name} · {t(`agentChat.${target.kind === 'folder' ? 'targetFolder' : 'plan'}`)}</label>
              {node.kind !== 'plan' && <Button onClick={() => void browse(node.path)}>{t('agentChat.browse', { path: node.path })}</Button>}</li>
          })}
        </ul>}
      </div>
    </Modal>
  )
}

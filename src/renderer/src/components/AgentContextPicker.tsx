import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import { DIARY_DIR } from '@shared/plan-types'
import type { AgentContextEntry, AgentContextSelection } from '@shared/agent-types'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { invoke } from '../ipc-client'
import { useTranslation } from '../i18n'

interface AgentContextPickerProps {
  selected: AgentContextEntry[]
  onChange: (entries: AgentContextEntry[]) => void
  onClose: () => void
}

export default function AgentContextPicker({ selected, onChange, onClose }: AgentContextPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [nodes, setNodes] = useState<PlanTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; epoch.current += 1 } }, [])
  const browse = async (parentPath: string): Promise<void> => {
    const current = ++epoch.current
    setPath(parentPath); setLoading(true); setError(''); setNodes([])
    try {
      const result = await invoke('agent:context:browse', { parentPath })
      if (live.current && current === epoch.current) setNodes(result)
    } catch { if (live.current && current === epoch.current) setError(t('agentChat.contextFailed')) }
    finally { if (live.current && current === epoch.current) setLoading(false) }
  }
  useEffect(() => { void browse('') }, [])
  const toggle = async (selection: AgentContextSelection): Promise<void> => {
    const existing = selected.find((entry) => entry.path === selection.path)
    if (existing) { onChange(selected.filter((entry) => entry.path !== selection.path)); return }
    setReading(true); setError('')
    try {
      const entry = await invoke('agent:context:read', selection)
      if (live.current) onChange([...selected, entry])
    } catch { if (live.current) setError(t('agentChat.contextFailed')) }
    finally { if (live.current) setReading(false) }
  }
  return (
    <Modal open title={t('agentChat.pickerTitle')} onCancel={onClose} footer={<Button onClick={onClose}>{t('agentChat.done')}</Button>} width={720}>
      <div className="agent-context-picker">
        <p className="agent-hint">{t('agentChat.localOnly')}</p>
        <header><strong>{path || t('agentChat.browseRoot')}</strong><Button disabled={!path || loading || reading} onClick={() => void browse(path.split('/').slice(0, -1).join('/'))}>{t('agentChat.up')}</Button></header>
        {loading && <p role="status">{t('common.loading')}</p>}
        {error && <p role="alert">{error}<Button onClick={() => void browse(path)}>{t('agentChat.retry')}</Button></p>}
        <ul className="agent-context-list">
          {nodes.map((node) => {
            const kind = node.path === `${DIARY_DIR}/${node.name}` && /^\d{4}-\d{2}-\d{2}$/.test(node.name) ? 'diary' : 'plan'
            return <li key={node.path}>
              {node.kind === 'plan' ? <label><input type="checkbox" aria-label={t('agentChat.selectSource', { path: node.path })} checked={selected.some((entry) => entry.path === node.path)} disabled={reading} onChange={() => void toggle({ kind, path: node.path })} />{node.name}<span>{t(`agentChat.${kind}`)}</span></label> : <span>{node.name} · {t('agentChat.folder')}</span>}
              {(node.kind === 'folder' || node.has_children) && <Button aria-label={t('agentChat.browse', { path: node.path })} disabled={loading || reading} onClick={() => void browse(node.path)}>{t('agentChat.browse', { path: node.path })}</Button>}
            </li>
          })}
        </ul>
        {!loading && !error && !nodes.length && <p>{t('agentChat.pickerEmpty')}</p>}
        <h3>{t('agentChat.sources')}</h3>
        {!selected.length && <p className="agent-hint">{t('agentChat.noSources')}</p>}
        {selected.map((entry) => <details className="agent-source" key={entry.path}><summary>{entry.path}</summary><p>{t('agentChat.version')}: {entry.version}</p><p>{t('agentChat.updated')}: {entry.updatedAt}</p><pre>{entry.content}</pre><Button aria-label={t('agentChat.removeSource', { path: entry.path })} disabled={reading} onClick={() => onChange(selected.filter((item) => item.path !== entry.path))}>{t('agentChat.removeSource', { path: entry.path })}</Button></details>)}
      </div>
    </Modal>
  )
}

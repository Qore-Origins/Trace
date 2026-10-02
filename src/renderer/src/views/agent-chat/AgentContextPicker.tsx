import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import { DIARY_DIR } from '@shared/plan-types'
import type { AgentContextEntry, AgentContextSelection } from '@shared/agent-types'
import type { PlanTreeNode } from '@shared/ipc-contract'
import { invoke } from '../../ipc-client'
import { useTranslation } from '../../i18n'
import type { StateSetter } from './types'

interface AgentContextPickerProps {
  selected: AgentContextEntry[]
  onChange: (entries: AgentContextEntry[]) => void
  onClose: () => void
}

interface PickerState {
  path: string
  nodes: PlanTreeNode[]
  loading: boolean
  reading: boolean
  error: string
  browse: (path: string) => Promise<void>
  toggle: (selection: AgentContextSelection) => Promise<void>
}

interface PickerBrowsingState {
  path: string
  nodes: PlanTreeNode[]
  loading: boolean
  browse: (path: string) => Promise<void>
  live: React.MutableRefObject<boolean>
}

interface PickerSelectionState {
  reading: boolean
  toggle: (selection: AgentContextSelection) => Promise<void>
}

export default function AgentContextPicker({
  selected,
  onChange,
  onClose
}: AgentContextPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const state = usePickerState({ selected, onChange })

  return (
    <Modal
      open
      title={t('agentChat.pickerTitle')}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t('agentChat.done')}</Button>}
      width={720}
    >
      <PickerContent state={state} selected={selected} onChange={onChange} />
    </Modal>
  )
}

function usePickerState({ selected, onChange }: Pick<AgentContextPickerProps, 'selected' | 'onChange'>): PickerState {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const browsing = usePickerBrowsing(setError)
  const selection = usePickerSelection({
    selected,
    onChange,
    setError,
    live: browsing.live
  })

  return {
    path: browsing.path,
    nodes: browsing.nodes,
    loading: browsing.loading,
    reading: selection.reading,
    error,
    browse: browsing.browse,
    toggle: selection.toggle
  }
}

function usePickerBrowsing(setError: StateSetter<string>): PickerBrowsingState {
  const { t } = useTranslation()
  const [path, setPath] = useState('')
  const [nodes, setNodes] = useState<PlanTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const epoch = useRef(0)
  const live = useRef(true)
  const browse = async (parentPath: string): Promise<void> => {
    const current = ++epoch.current
    setPath(parentPath)
    setLoading(true)
    setError('')
    setNodes([])
    try {
      const result = await invoke('agent:context:browse', { parentPath })
      if (live.current && current === epoch.current) setNodes(result)
    } catch {
      if (live.current && current === epoch.current) setError(t('agentChat.contextFailed'))
    } finally {
      if (live.current && current === epoch.current) setLoading(false)
    }
  }
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      epoch.current += 1
    }
  }, [])
  useEffect(() => {
    void browse('')
  }, [])

  return { path, nodes, loading, browse, live }
}

function usePickerSelection({
  selected,
  onChange,
  setError,
  live
}: {
  selected: AgentContextEntry[]
  onChange: AgentContextPickerProps['onChange']
  setError: StateSetter<string>
  live: React.MutableRefObject<boolean>
}): PickerSelectionState {
  const { t } = useTranslation()
  const [reading, setReading] = useState(false)
  const toggle = async (selection: AgentContextSelection): Promise<void> => {
    const existing = selected.find((entry) => entry.path === selection.path)
    if (existing) {
      onChange(selected.filter((entry) => entry.path !== selection.path))
      return
    }
    setReading(true)
    setError('')
    try {
      const entry = await invoke('agent:context:read', selection)
      if (live.current) onChange([...selected, entry])
    } catch {
      if (live.current) setError(t('agentChat.contextFailed'))
    } finally {
      if (live.current) setReading(false)
    }
  }
  return { reading, toggle }
}

interface PickerContentProps {
  state: PickerState
  selected: AgentContextEntry[]
  onChange: (entries: AgentContextEntry[]) => void
}

function PickerContent({ state, selected, onChange }: PickerContentProps): React.JSX.Element {
  const { t } = useTranslation()
  const parentPath = state.path.split('/').slice(0, -1).join('/')

  return (
    <div className="agent-context-picker">
      <p className="agent-hint">{t('agentChat.localOnly')}</p>
      <PickerHeader state={state} parentPath={parentPath} />
      {state.loading && <p role="status">{t('common.loading')}</p>}
      {state.error && <PickerError state={state} />}
      <ContextNodeList state={state} selected={selected} />
      <PickerEmpty state={state} />
      <h3>{t('agentChat.sources')}</h3>
      {!selected.length && <p className="agent-hint">{t('agentChat.noSources')}</p>}
      <SelectedSources selected={selected} onChange={onChange} reading={state.reading} />
    </div>
  )
}

function PickerHeader({ state, parentPath }: { state: PickerState; parentPath: string }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header>
      <strong>{state.path || t('agentChat.browseRoot')}</strong>
      <Button
        disabled={!state.path || state.loading || state.reading}
        onClick={() => void state.browse(parentPath)}
      >
        {t('agentChat.up')}
      </Button>
    </header>
  )
}

function PickerError({ state }: { state: PickerState }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p role="alert">
      {state.error}
      <Button onClick={() => void state.browse(state.path)}>{t('agentChat.retry')}</Button>
    </p>
  )
}

function PickerEmpty({ state }: { state: PickerState }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (state.loading || state.error || state.nodes.length) return null
  return <p>{t('agentChat.pickerEmpty')}</p>
}

function ContextNodeList({
  state,
  selected
}: {
  state: PickerState
  selected: AgentContextEntry[]
}): React.JSX.Element {
  return (
    <ul className="agent-context-list">
      {state.nodes.map((node) => (
        <ContextNode key={node.path} node={node} state={state} selected={selected} />
      ))}
    </ul>
  )
}

function ContextNode({
  node,
  state,
  selected
}: {
  node: PlanTreeNode
  state: PickerState
  selected: AgentContextEntry[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const kind = getSelectionKind(node)

  return (
    <li>
      {node.kind === 'plan' ? (
        <label>
          <input
            type="checkbox"
            aria-label={t('agentChat.selectSource', { path: node.path })}
            checked={selected.some((entry) => entry.path === node.path)}
            disabled={state.reading}
            onChange={() => void state.toggle({ kind, path: node.path })}
          />
          {node.name}
          <span>{t(`agentChat.${kind}`)}</span>
        </label>
      ) : (
        <span>{node.name} · {t('agentChat.folder')}</span>
      )}
      <BrowseNodeButton node={node} state={state} />
    </li>
  )
}

function BrowseNodeButton({ node, state }: { node: PlanTreeNode; state: PickerState }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (node.kind !== 'folder' && !node.has_children) return null
  const label = t('agentChat.browse', { path: node.path })

  return (
    <Button
      aria-label={label}
      disabled={state.loading || state.reading}
      onClick={() => void state.browse(node.path)}
    >
      {label}
    </Button>
  )
}

function SelectedSources({
  selected,
  onChange,
  reading
}: {
  selected: AgentContextEntry[]
  onChange: (entries: AgentContextEntry[]) => void
  reading: boolean
}): React.JSX.Element {
  return (
    <>
      {selected.map((entry) => (
        <SelectedSource
          key={entry.path}
          entry={entry}
          reading={reading}
          onRemove={() => onChange(selected.filter((item) => item.path !== entry.path))}
        />
      ))}
    </>
  )
}

function SelectedSource({
  entry,
  reading,
  onRemove
}: {
  entry: AgentContextEntry
  reading: boolean
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const removeLabel = t('agentChat.removeSource', { path: entry.path })

  return (
    <details className="agent-source">
      <summary>{entry.path}</summary>
      <p>{t('agentChat.version')}: {entry.version}</p>
      <p>{t('agentChat.updated')}: {entry.updatedAt}</p>
      <pre>{entry.content}</pre>
      <Button aria-label={removeLabel} disabled={reading} onClick={onRemove}>
        {removeLabel}
      </Button>
    </details>
  )
}

function getSelectionKind(node: PlanTreeNode): AgentContextSelection['kind'] {
  const isDiary = node.path === `${DIARY_DIR}/${node.name}`
    && /^\d{4}-\d{2}-\d{2}$/.test(node.name)
  return isDiary ? 'diary' : 'plan'
}

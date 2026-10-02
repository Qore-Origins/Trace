import { useEffect, useRef, useState } from 'react'
import { Button, Modal } from 'antd'
import type { AgentContextEntry, AgentOutboundPreview, AgentProfileList, AgentRequestEvent, AgentRequestIdentity, AgentSession, AgentSessionSummary } from '@shared/agent-types'
import AgentContextPicker from '../components/AgentContextPicker'
import { invoke, onEvent } from '../ipc-client'
import { getModal } from '../antd-host'
import { i18n, useTranslation } from '../i18n'
import { agentChatZhCN } from '../i18n/locales/agent-chat-zh-CN'
import { agentChatEnUS } from '../i18n/locales/agent-chat-en-US'
import { useUiStore } from '../stores/ui-store'

i18n.addResourceBundle('zh-CN', 'translation', { agentChat: agentChatZhCN }, true, true)
i18n.addResourceBundle('en-US', 'translation', { agentChat: agentChatEnUS }, true, true)

export default function AgentView(): React.JSX.Element {
  const { t } = useTranslation()
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const [profiles, setProfiles] = useState<AgentProfileList>({ profiles: [], defaultProfileId: null })
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([])
  const [session, setSession] = useState<AgentSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sources, setSources] = useState<AgentContextEntry[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [preview, setPreview] = useState<AgentOutboundPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [partialIds, setPartialIds] = useState<string[]>([])
  const previewEpoch = useRef(0)
  const previewToken = useRef<string | null>(null)
  const activeId = useRef<string | null>(null)
  const readEpoch = useRef(0)
  const refreshEpoch = useRef(0)
  const live = useRef(true)
  const sessionRef = useRef<AgentSession | null>(null)
  const identities = useRef(new Map<string, AgentRequestIdentity>())
  const earlyEvent = useRef<AgentRequestEvent | null>(null)
  sessionRef.current = session

  const readSession = async (id: string): Promise<void> => {
    const epoch = ++readEpoch.current
    let result = await invoke('agent:session:read', { id })
    if (!live.current || activeId.current !== id || epoch !== readEpoch.current) return
    const pending = earlyEvent.current
    if (pending?.sessionId === id && result.messages.some((item) => item.id === pending.assistantId && item.requestId === pending.requestId)) {
      earlyEvent.current = null
      // The event was persisted before emission; reread after identifying its turn.
      result = await invoke('agent:session:read', { id })
    }
    if (live.current && activeId.current === id && epoch === readEpoch.current) { sessionRef.current = result; setSession(result) }
  }
  const refresh = async (): Promise<void> => {
    const epoch = ++refreshEpoch.current
    setLoading(true); setError('')
    try {
      const [nextProfiles, nextSessions] = await Promise.all([invoke('agent:profile:list'), invoke('agent:session:list')])
      if (!live.current || epoch !== refreshEpoch.current) return
      setProfiles(nextProfiles); setSessions(nextSessions)
      if (activeId.current && !nextSessions.some((item) => item.id === activeId.current)) { activeId.current = null; setSession(null) }
      if (!activeId.current && nextSessions[0]) activeId.current = nextSessions[0].id
      if (activeId.current) await readSession(activeId.current)
    } catch { if (live.current && epoch === refreshEpoch.current) setError(t('agentChat.failed')) }
    finally { if (live.current && epoch === refreshEpoch.current) setLoading(false) }
  }
  const cancelPreview = async (): Promise<void> => {
    const token = previewToken.current
    previewToken.current = null
    if (token) await invoke('agent:preview:cancel', { token })
  }
  useEffect(() => { live.current = true; return () => {
    live.current = false; readEpoch.current += 1; refreshEpoch.current += 1; previewEpoch.current += 1
    void cancelPreview().catch(() => undefined)
  } }, [])
  useEffect(() => {
    if (!settingsOpen) { void refresh(); return }
    refreshEpoch.current += 1
    closePreview(); setPickerOpen(false)
  }, [settingsOpen])
  useEffect(() => onEvent('trace:agent-request', (event) => {
    if (!live.current || event.sessionId !== activeId.current) return
    const known = identities.current.get(event.sessionId)
    const persisted = sessionRef.current?.messages.find((item) => item.id === event.assistantId && item.requestId === event.requestId && item.status === 'streaming')
    if ((!known || known.requestId !== event.requestId || known.assistantId !== event.assistantId) && !persisted) { earlyEvent.current = event; return }
    void readSession(event.sessionId).catch(() => { if (live.current && activeId.current === event.sessionId) setError(t('agentChat.failed')) })
    if (event.type === 'terminal') {
      identities.current.delete(event.sessionId)
      void invoke('agent:session:list').then((items) => { if (live.current) setSessions(items) }).catch(() => undefined)
    }
  }), [])

  const operate = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch { if (live.current) setError(t('agentChat.failed')) }
    finally { if (live.current) setBusy(false) }
  }
  const createSession = (): void => {
    const profileId = profiles.defaultProfileId ?? profiles.profiles[0]?.id
    if (!profileId) return
    void operate(async () => {
      const result = await invoke('agent:session:create', { title: t('agentChat.newSession'), profileId })
      if (!live.current) return
      activeId.current = result.id; readEpoch.current += 1; setSession(result)
      setDraft(''); setSources([]); setIncludeHistory(true); setPartialIds([])
      setSessions(await invoke('agent:session:list'))
    })
  }
  const deleteSession = (): void => {
    if (!session) return
    const id = session.id
    getModal().confirm({
      title: t('agentChat.deleteTitle'), content: t('agentChat.deleteWarning'), okText: t('agentChat.delete'), cancelText: t('agentChat.cancel'),
      onOk: () => operate(async () => {
        await invoke('agent:session:delete', { id })
        if (!live.current) return
        activeId.current = null; readEpoch.current += 1; setSession(null); await refresh()
      })
    })
  }
  const currentProfile = profiles.profiles.find((item) => item.id === session?.profileId)
  const streamingMessage = session?.messages.find((item) => item.role === 'assistant' && item.status === 'streaming')
  const sending = useRef(false)
  const closePreview = (): void => {
    if (sending.current) return
    previewEpoch.current += 1; setPreviewOpen(false); setPreview(null); setPreviewLoading(false)
    void cancelPreview().catch(() => { if (live.current) setError(t('agentChat.previewFailed')) })
  }
  const makePreview = async (entries = sources, history = includeHistory, partials = partialIds): Promise<void> => {
    if (!session || !currentProfile || currentProfile.keyStatus === 'missing') return
    const current = ++previewEpoch.current
    const id = session.id
    setPreviewOpen(true); setPreviewLoading(true); setPreview(null); setError('')
    try {
      await cancelPreview()
      if (!live.current || current !== previewEpoch.current) return
      const result = await invoke('agent:preview:create', { sessionId: id, message: draft, selections: entries.map(({ kind, path }) => ({ kind, path })), includeHistory: history, includePartialMessageIds: partials })
      if (!live.current || current !== previewEpoch.current || activeId.current !== id) {
        await invoke('agent:preview:cancel', { token: result.token }); return
      }
      previewToken.current = result.token; setPreview(result)
    } catch { if (live.current && current === previewEpoch.current) setError(t('agentChat.previewFailed')) }
    finally { if (live.current && current === previewEpoch.current) setPreviewLoading(false) }
  }
  const changeProfile = (profileId: string): void => {
    if (!session) return
    const id = session.id
    void operate(async () => {
      const result = await invoke('agent:session:update', { id, title: session.title, profileId })
      if (live.current && activeId.current === id) setSession(result)
      if (live.current) setSessions(await invoke('agent:session:list'))
    })
  }
  const confirmSend = (): void => {
    if (!preview || previewLoading || busy || preview.token !== previewToken.current) return
    const approved = preview
    sending.current = true
    void operate(async () => {
      previewToken.current = null; previewEpoch.current += 1
      try {
        const identity = await invoke('agent:request:send', { token: approved.token, sessionId: approved.sessionId })
        identities.current.set(identity.sessionId, identity)
        if (!live.current || activeId.current !== identity.sessionId) return
        setDraft(''); setPartialIds([]); await readSession(identity.sessionId)
        if (live.current) setSessions(await invoke('agent:session:list'))
      } catch {
        if (live.current) {
          setError(t('agentChat.previewFailed'))
          await readSession(approved.sessionId).catch(() => undefined)
        }
      } finally {
        sending.current = false
        if (live.current) { setPreviewOpen(false); setPreview(null) }
      }
    })
  }
  const stop = (): void => {
    if (!session || !streamingMessage) return
    const id = session.id
    void operate(async () => {
      await invoke('agent:request:cancel', { sessionId: id, requestId: streamingMessage.requestId })
      if (activeId.current === id) await readSession(id)
    })
  }
  return (
    <main className="agent-view" data-agent-ready={!loading}>
      <aside className="agent-rail" aria-label={t('agentChat.sessions')}>
        <header><h2>{t('agentChat.sessions')}</h2><Button disabled={busy || loading || previewOpen || pickerOpen || !profiles.profiles.length} onClick={createSession}>{t('agentChat.newSession')}</Button></header>
        <nav aria-label={t('agentChat.sessions')}>
          {sessions.map((item) => <button className="agent-session" type="button" key={item.id} aria-current={item.id === session?.id ? 'page' : undefined} disabled={busy || loading || previewOpen || pickerOpen} onClick={() => {
            activeId.current = item.id; setSession(null); setDraft(''); setSources([]); setIncludeHistory(true); setPartialIds([])
            void operate(() => readSession(item.id))
          }}>{item.title}</button>)}
        </nav>
      </aside>
      <section className="agent-conversation">
        {error && <p role="alert">{error}<Button onClick={() => void refresh()} disabled={busy}>{t('agentChat.retry')}</Button></p>}
        {loading && <p role="status">{t('common.loading')}</p>}
        {!profiles.profiles.length && !loading && <p>{t('agentChat.noProfiles')}<Button onClick={() => useUiStore.getState().setSettingsOpen(true)}>{t('agentChat.settings')}</Button></p>}
        {session ? <>
          <header className="agent-toolbar"><h1>{session.title}</h1><Button onClick={deleteSession} disabled={busy || !!streamingMessage || previewOpen}>{t('agentChat.deleteSession')}</Button></header>
          <label className="agent-profile">{t('agentChat.profile')}<select aria-label={t('agentChat.profile')} value={session.profileId} disabled={busy || loading || !!streamingMessage || previewOpen} onChange={(event) => changeProfile(event.target.value)}>
            {!currentProfile && <option value={session.profileId}>{t('agentChat.missingProfile')}</option>}
            {profiles.profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
          </select></label>
          {(!currentProfile || currentProfile.keyStatus === 'missing') && <p role="status">{t(currentProfile ? 'agentChat.missingKey' : 'agentChat.missingProfile')}<Button onClick={() => useUiStore.getState().setSettingsOpen(true)}>{t('agentChat.settings')}</Button></p>}
          <div className="agent-transcript" role="log" aria-label={t('agentChat.message')} aria-live="polite">
            {!session.messages.length && <p>{t('agentChat.empty')}</p>}
            {session.messages.map((item) => <article className={`agent-message agent-message--${item.role}`} key={item.id}>
              <header><strong>{t(`agentChat.${item.role}`)}</strong>{item.status === 'streaming' && <span className="agent-message-status">{t('agentChat.streaming')}</span>}</header>
              <pre>{item.content}</pre>
              {item.status === 'user-interrupted' && <p className="agent-interruption">【用户中断】</p>}
              {item.status === 'error-interrupted' && <p className="agent-interruption">【异常中断】 {t('agentChat.exception')}</p>}
              {item.role === 'assistant' && session.requests.filter((request) => request.id === item.requestId).map((request) => <details className="agent-provenance" key={request.id}><summary>{request.profileName} · {request.model} · {request.requestedAt}</summary>{request.sources.map((source) => <p key={source.path}>{source.path} · {source.version}</p>)}</details>)}
            </article>)}
          </div>
          <form className="agent-composer" onSubmit={(event) => event.preventDefault()}>
            <label>{t('agentChat.message')}<textarea aria-label={t('agentChat.message')} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || previewOpen} rows={3} /></label>
            <div className="agent-composer-actions"><Button disabled={busy || previewOpen} onClick={() => setPickerOpen(true)}>{t('agentChat.context')}</Button>{streamingMessage ? <Button disabled={busy} onClick={stop}>{t('agentChat.stop')}</Button> : <Button disabled={busy || previewOpen || !draft.trim() || !currentProfile || currentProfile.keyStatus === 'missing'} onClick={() => void makePreview()}>{t('agentChat.preview')}</Button>}</div>
            <div className="agent-selected-sources">{sources.map((entry) => <div className="agent-source" key={entry.path}><span>{entry.path}</span><small>{t('agentChat.version')}: {entry.version}</small><Button aria-label={t('agentChat.removeSource', { path: entry.path })} disabled={previewOpen} onClick={() => setSources(sources.filter((item) => item.path !== entry.path))}>{t('agentChat.removeSource', { path: entry.path })}</Button></div>)}</div>
          </form>
        </> : !loading && <p>{t('agentChat.noSession')}</p>}
      </section>
      {pickerOpen && <AgentContextPicker selected={sources} onChange={setSources} onClose={() => setPickerOpen(false)} />}
      <Modal open={previewOpen} title={t('agentChat.previewTitle')} onCancel={closePreview} closable={!busy} maskClosable={!busy} keyboard={!busy} width={860} footer={<><Button disabled={busy} onClick={closePreview}>{t('agentChat.cancel')}</Button><Button type="primary" loading={busy} disabled={busy || previewLoading || !preview} onClick={confirmSend}>{t('agentChat.confirm')}</Button></>}>
        <div className="agent-preview">
          <p className="agent-hint">{t('agentChat.previewHint')}</p>
          {error && <p role="alert">{error}</p>}
          <label><input type="checkbox" aria-label={t('agentChat.includeHistory')} checked={includeHistory} disabled={busy || previewLoading} onChange={(event) => { setIncludeHistory(event.target.checked); void makePreview(sources, event.target.checked, partialIds) }} />{t('agentChat.includeHistory')}</label>
          {session?.messages.filter((item) => item.role === 'assistant' && (item.status === 'user-interrupted' || item.status === 'error-interrupted')).map((item) => <label key={item.id}><input type="checkbox" aria-label={t('agentChat.partial')} checked={partialIds.includes(item.id)} disabled={busy || previewLoading || !includeHistory} onChange={(event) => {
            const next = event.target.checked ? [...partialIds, item.id] : partialIds.filter((id) => id !== item.id); setPartialIds(next); void makePreview(sources, includeHistory, next)
          }} />{t('agentChat.partial')} · {item.createdAt}</label>)}
          {previewLoading && <p role="status">{t('common.loading')}</p>}
          {preview && <>
            <dl><dt>{t('agentChat.profile')}</dt><dd>{preview.target.name} ({preview.target.id})</dd><dt>{t('agentChat.destination')}</dt><dd>{requestUrl(preview.target.endpoint)}</dd><dt>{t('agentChat.protocol')}</dt><dd>{preview.target.protocol}</dd><dt>{t('agentChat.model')}</dt><dd>{preview.target.model}</dd></dl>
            <h3>{t('agentChat.userText')}</h3><pre>{preview.message}</pre>
            <h3>{t('agentChat.history')}</h3>{!preview.history.length && <p>{t('agentChat.noHistory')}</p>}
            {preview.history.map((item, index) => <div key={`${item.messageId}-${index}`}><strong>{t(`agentChat.role.${item.role}`)}</strong><pre>{item.content}</pre></div>)}
            <h3>{t('agentChat.sources')}</h3>{!preview.contexts.length && <p>{t('agentChat.noSources')}</p>}
            {preview.contexts.map((entry) => <section className="agent-source" key={entry.path}><strong>{entry.path}</strong><p>{t('agentChat.version')}: {entry.version}</p><p>{t('agentChat.updated')}: {entry.updatedAt}</p><pre>{entry.content}</pre><Button aria-label={t('agentChat.removeSource', { path: entry.path })} disabled={busy || previewLoading} onClick={() => {
              const entries = sources.filter((item) => item.path !== entry.path); setSources(entries); void makePreview(entries)
            }}>{t('agentChat.removeSource', { path: entry.path })}</Button></section>)}
            <h3>{t('agentChat.payload')}</h3><pre data-agent-payload>{JSON.stringify(preview.messages, null, 2)}</pre>
          </>}
        </div>
      </Modal>
    </main>
  )
}

function requestUrl(endpoint: string): string {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.toString()
}

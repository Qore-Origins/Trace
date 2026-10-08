import { Button } from 'antd'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from '../../i18n'
import { useUiStore } from '../../stores/ui-store'
import type { AgentContextEntry, AgentSession } from '@shared/agent-types'
import type { AgentChatController } from './types'
import AgentContextPicker from './AgentContextPicker'
import AgentPreviewDialog from './AgentPreviewDialog'
import AgentTargetPicker, { targetKey } from './AgentTargetPicker'
import AgentOperationView from './AgentOperationView'

interface ChatProps {
  chat: AgentChatController
}

const NARROW_WORKBENCH_QUERY = '(max-width: 960px)'

export default function AgentChatPage({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()
  const [surface, setSurface] = useState('conversation')
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_WORKBENCH_QUERY).matches)
  const workbench = useRef<HTMLDivElement>(null)
  const pendingRegionFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const media = window.matchMedia(NARROW_WORKBENCH_QUERY)
    let previous = narrow
    const synchronize = (): void => {
      const next = media.matches
      if (next === previous) return
      previous = next
      const focused = document.activeElement
      if (next) {
        for (const value of ['conversation', 'work']) {
          if (workbench.current?.querySelector(`#agent-${value}-surface`)?.contains(focused)) setSurface(value)
        }
      } else if (focused?.getAttribute('role') === 'tab' && workbench.current?.contains(focused)) {
        const panelId = focused.getAttribute('aria-controls')
        pendingRegionFocus.current = panelId ? workbench.current.querySelector<HTMLElement>(`#${panelId}`) : null
      }
      setNarrow(next)
    }
    synchronize()
    media.addEventListener('change', synchronize)
    return () => media.removeEventListener('change', synchronize)
  }, [])
  useLayoutEffect(() => {
    // The region must have its desktop semantics and programmatic tabindex before receiving focus.
    pendingRegionFocus.current?.focus({ preventScroll: true })
    pendingRegionFocus.current = null
  }, [narrow])
  const composerHasFocus = (): boolean => document.activeElement === workbench.current?.querySelector('.agent-composer textarea')
  const [requestId, setRequestId] = useState('')
  const latestRequest = chat.session?.messages.filter((message) => message.role === 'user').at(-1)?.requestId ?? ''
  const lastRequest = useRef('')
  useEffect(() => {
    if (lastRequest.current !== latestRequest) {
      lastRequest.current = latestRequest
      setRequestId(latestRequest)
    }
  }, [chat.session?.id, latestRequest])
  return (
    <main className="agent-view" data-agent-ready={!chat.loading}>
      <AgentSessionRail chat={chat} />
      <div className="agent-workbench" data-agent-surface={surface} ref={workbench}>
        {narrow && <div className="agent-surface-switch" role="tablist" aria-label={t('agentChat.workbench')}>
          {['conversation', 'work'].map((value) => <button type="button" role="tab" key={value}
            aria-selected={surface === value} aria-controls={`agent-${value}-surface`} id={`agent-${value}-tab`}
            tabIndex={surface === value ? 0 : -1}
            onMouseDown={(event) => { if (composerHasFocus()) event.preventDefault() }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = value === 'conversation' ? 'work' : 'conversation'
              setSurface(next)
              document.getElementById(`agent-${next}-tab`)?.focus({ preventScroll: true })
            }}
            onClick={(event) => {
              setSurface(value)
              if (!composerHasFocus()) event.currentTarget.focus({ preventScroll: true })
            }}>{t(`agentChat.${value === 'work' ? 'workContent' : 'conversation'}`)}</button>)}
        </div>}
        <AgentConversation chat={chat} requestId={requestId} setRequestId={setRequestId} narrow={narrow} active={surface === 'conversation'} />
        <section className="agent-work-content" id="agent-work-surface" role={narrow ? 'tabpanel' : 'region'}
          tabIndex={narrow ? undefined : -1}
          aria-labelledby={narrow ? 'agent-work-tab' : undefined} aria-label={narrow ? undefined : t('agentChat.workContent')}
          aria-hidden={narrow ? surface !== 'work' : undefined}>
          <AgentOperationView chat={chat} requestId={requestId} />
        </section>
        {chat.session && <AgentComposer chat={chat} />}
      </div>
      {chat.pickerOpen && (
        <AgentContextPicker
          selected={chat.sources}
          onChange={chat.setSources}
          onClose={() => chat.setPickerOpen(false)}
        />
      )}
      {chat.targetPickerOpen && <AgentTargetPicker selected={chat.targets} onChange={chat.setTargets} onClose={() => chat.setTargetPickerOpen(false)} />}
      <AgentPreviewDialog chat={chat} />
    </main>
  )
}
function AgentSessionRail({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <aside className="agent-rail" aria-label={t('agentChat.sessions')}>
      <header>
        <h2>{t('agentChat.sessions')}</h2>
        <Button
          disabled={chat.busy || chat.loading || chat.previewOpen || chat.pickerOpen || chat.targetPickerOpen
            || !chat.profiles.profiles.length}
          onClick={chat.createSession}
        >
          {t('agentChat.newSession')}
        </Button>
      </header>
      <nav aria-label={t('agentChat.sessions')}>
        {chat.sessions.map((session) => (
          <SessionButton key={session.id} chat={chat} session={session} />
        ))}
      </nav>
    </aside>
  )
}

function SessionButton({
  chat,
  session
}: ChatProps & { session: AgentChatController['sessions'][number] }): React.JSX.Element {
  return (
    <button
      className="agent-session"
      type="button"
      aria-current={session.id === chat.session?.id ? 'page' : undefined}
      disabled={chat.busy || chat.loading || chat.previewOpen || chat.pickerOpen || chat.targetPickerOpen}
      onClick={() => chat.switchSession(session.id)}
    >
      {session.title}
    </button>
  )
}

function AgentConversation({ chat, requestId, setRequestId, narrow, active }: ChatProps & {
  requestId: string; setRequestId: (id: string) => void; narrow: boolean; active: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="agent-conversation" id="agent-conversation-surface" role={narrow ? 'tabpanel' : 'region'}
      tabIndex={narrow ? undefined : -1}
      aria-labelledby={narrow ? 'agent-conversation-tab' : undefined} aria-label={narrow ? undefined : t('agentChat.conversation')}
      aria-hidden={narrow ? !active : undefined}>
      {chat.error && <ConversationError chat={chat} />}
      {chat.loading && <p role="status">{t('common.loading')}</p>}
      {!chat.profiles.profiles.length && !chat.loading && <NoProfilesMessage />}
      {chat.session ? (
        <AgentSessionView chat={chat} requestId={requestId} setRequestId={setRequestId} />
      ) : (
        !chat.loading && <p>{t('agentChat.noSession')}</p>
      )}
    </section>
  )
}

function ConversationError({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p role="alert">
      {chat.error}
      <Button onClick={() => void chat.refresh()} disabled={chat.busy}>
        {t('agentChat.retry')}
      </Button>
    </p>
  )
}

function NoProfilesMessage(): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p>
      {t('agentChat.noProfiles')}
      <Button onClick={() => useUiStore.getState().setSettingsOpen(true)}>
        {t('agentChat.settings')}
      </Button>
    </p>
  )
}

function AgentSessionView({ chat, requestId, setRequestId }: ChatProps & { requestId: string; setRequestId: (id: string) => void }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!chat.session) return null

  return (
    <>
      <SessionHeader chat={chat} session={chat.session} />
      <ProfileSelector chat={chat} session={chat.session} />
      <MissingCredentialMessage chat={chat} />
      {!!chat.session.messages.length && <label className="agent-profile">{t('agentChat.batch')}
        <select data-agent-batch-choice aria-label={t('agentChat.batch')} value={requestId} onChange={(event) => setRequestId(event.target.value)}>
          {chat.session.messages.filter((message) => message.role === 'user').map((message) => <option key={message.id} value={message.requestId}>{message.content.slice(0, 60)}</option>)}
        </select>
      </label>}
      <AgentTranscript chat={chat} session={chat.session} requestId={requestId} />
    </>
  )
}

function SessionHeader({ chat, session }: ChatProps & { session: AgentSession }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <header className="agent-toolbar">
      <h1>{session.title}</h1>
      <Button
        onClick={chat.deleteSession}
        disabled={chat.busy || !!chat.streamingMessage || chat.previewOpen}
      >
        {t('agentChat.deleteSession')}
      </Button>
    </header>
  )
}

function ProfileSelector({ chat, session }: ChatProps & { session: AgentSession }): React.JSX.Element {
  const { t } = useTranslation()
  const disabled = chat.busy || chat.loading || !!chat.streamingMessage || chat.previewOpen

  return (
    <label className="agent-profile">
      {t('agentChat.profile')}
      <select
        aria-label={t('agentChat.profile')}
        value={session.profileId}
        disabled={disabled}
        onChange={(event) => chat.changeProfile(event.target.value)}
      >
        {!chat.currentProfile && (
          <option value={session.profileId}>{t('agentChat.missingProfile')}</option>
        )}
        {chat.profiles.profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.model}
          </option>
        ))}
      </select>
    </label>
  )
}

function MissingCredentialMessage({ chat }: ChatProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (chat.currentProfile && chat.currentProfile.keyStatus !== 'missing') return null
  const message = chat.currentProfile
    ? 'agentChat.missingKey'
    : 'agentChat.missingProfile'

  return (
    <p role="status">
      {t(message)}
      <Button onClick={() => useUiStore.getState().setSettingsOpen(true)}>
        {t('agentChat.settings')}
      </Button>
    </p>
  )
}

function AgentTranscript({
  chat,
  session,
  requestId
}: ChatProps & { session: AgentSession; requestId: string }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="agent-transcript"
      role="log"
      aria-label={t('agentChat.message')}
      aria-live="polite"
    >
      {!session.messages.length && <p>{t('agentChat.empty')}</p>}
      {session.messages.filter((message) => message.requestId === requestId && message.role !== 'tool').map((message) => (
        <TranscriptMessage key={message.id} message={message} session={session} />
      ))}
    </div>
  )
}

function TranscriptMessage({
  message,
  session
}: {
  message: AgentSession['messages'][number]
  session: AgentSession
}): React.JSX.Element {
  const { t } = useTranslation()
  const requests = session.requests.filter((request) => request.id === message.requestId)

  return (
    <article className={`agent-message agent-message--${message.role}`}>
      <header>
        <strong>{t(`agentChat.${message.role}`)}</strong>
        {message.status === 'streaming' && (
          <span className="agent-message-status">{t('agentChat.streaming')}</span>
        )}
      </header>
      <pre>{message.content}</pre>
      {message.status === 'user-interrupted' && (
        <p className="agent-interruption">【用户中断】</p>
      )}
      {message.status === 'error-interrupted' && (
        <p className="agent-interruption">【异常中断】 {t('agentChat.exception')}</p>
      )}
      {message.role === 'assistant' && <RequestProvenance requests={requests} />}
    </article>
  )
}

function RequestProvenance({
  requests
}: {
  requests: AgentSession['requests']
}): React.JSX.Element {
  return (
    <>
      {requests.map((request) => (
        <details className="agent-provenance" key={request.id}>
          <summary>{request.profileName} · {request.model} · {request.requestedAt}</summary>
          {request.sources.map((source) => (
            <p key={source.path}>{source.path} · {source.version}</p>
          ))}
        </details>
      ))}
    </>
  )
}

function AgentComposer({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()
  const composing = useRef(false)

  return (
    <form className="agent-composer" onSubmit={(event) => event.preventDefault()}>
      <label>
        {t('agentChat.message')}
        <textarea
          aria-label={t('agentChat.message')}
          value={chat.draft}
          onChange={(event) => chat.setDraft(event.target.value)}
          disabled={chat.busy || chat.previewOpen}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={() => { composing.current = false }}
          onKeyDown={(event) => {
            if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.ctrlKey && event.key === 'Enter' && !isPreviewDisabled(chat)) {
              event.preventDefault()
              void chat.makePreview()
            }
          }}
          rows={3}
        />
      </label>
      <ComposerActions chat={chat} />
      <p className="agent-hint">{t('agentChat.targetHint')}</p>
      <div className="agent-target-chips">
        {!chat.targets.length && <span>{t('agentChat.noTargets')}</span>}
        {chat.targets.map((target) => <Button key={targetKey(target)} disabled={chat.previewOpen}
          onClick={() => chat.setTargets(chat.targets.filter((item) => targetKey(item) !== targetKey(target)))}
          aria-label={t('agentChat.removeTarget', { path: target.kind === 'trash' ? target.entryId : target.path })}>
          @{target.kind === 'trash' ? t('agentChat.trash') : target.path}
        </Button>)}
      </div>
      <ComposerSources chat={chat} />
    </form>
  )
}

function ComposerActions({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="agent-composer-actions">
      <Button disabled={chat.busy || chat.previewOpen} onClick={() => chat.setTargetPickerOpen(true)}>{t('agentChat.targets')}</Button>
      <Button
        disabled={chat.busy || chat.previewOpen}
        onClick={() => chat.setPickerOpen(true)}
      >
        {t('agentChat.context')}
      </Button>
      {chat.streamingMessage ? (
        <Button disabled={chat.busy} onClick={chat.stop}>
          {t('agentChat.stop')}
        </Button>
      ) : (
        <Button
          disabled={isPreviewDisabled(chat)}
          onClick={() => void chat.makePreview()}
        >
          {t('agentChat.preview')}
        </Button>
      )}
    </div>
  )
}

function isPreviewDisabled(chat: AgentChatController): boolean {
  return chat.busy
    || chat.previewOpen
    || chat.targetPickerOpen
    || !chat.draft.trim()
    || !chat.currentProfile
    || chat.currentProfile.keyStatus === 'missing'
}

function ComposerSources({ chat }: ChatProps): React.JSX.Element {
  return (
    <div className="agent-selected-sources">
      {chat.sources.map((source) => (
        <ComposerSource key={source.path} source={source} chat={chat} />
      ))}
    </div>
  )
}

function ComposerSource({
  source,
  chat
}: ChatProps & { source: AgentContextEntry }): React.JSX.Element {
  const { t } = useTranslation()
  const removeLabel = t('agentChat.removeSource', { path: source.path })

  return (
    <div className="agent-source">
      <span>{source.path}</span>
      <small>{t('agentChat.version')}: {source.version}</small>
      <Button
        aria-label={removeLabel}
        disabled={chat.previewOpen}
        onClick={() => chat.setSources(chat.sources.filter((item) => item.path !== source.path))}
      >
        {removeLabel}
      </Button>
    </div>
  )
}

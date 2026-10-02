import { Button } from 'antd'
import { useTranslation } from '../../i18n'
import { useUiStore } from '../../stores/ui-store'
import type { AgentContextEntry, AgentSession } from '@shared/agent-types'
import type { AgentChatController } from './types'
import AgentContextPicker from './AgentContextPicker'
import AgentPreviewDialog from './AgentPreviewDialog'

interface ChatProps {
  chat: AgentChatController
}

export default function AgentChatPage({ chat }: ChatProps): React.JSX.Element {
  return (
    <main className="agent-view" data-agent-ready={!chat.loading}>
      <AgentSessionRail chat={chat} />
      <AgentConversation chat={chat} />
      {chat.pickerOpen && (
        <AgentContextPicker
          selected={chat.sources}
          onChange={chat.setSources}
          onClose={() => chat.setPickerOpen(false)}
        />
      )}
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
          disabled={chat.busy || chat.loading || chat.previewOpen || chat.pickerOpen
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
      disabled={chat.busy || chat.loading || chat.previewOpen || chat.pickerOpen}
      onClick={() => chat.switchSession(session.id)}
    >
      {session.title}
    </button>
  )
}

function AgentConversation({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section className="agent-conversation">
      {chat.error && <ConversationError chat={chat} />}
      {chat.loading && <p role="status">{t('common.loading')}</p>}
      {!chat.profiles.profiles.length && !chat.loading && <NoProfilesMessage />}
      {chat.session ? (
        <AgentSessionView chat={chat} />
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

function AgentSessionView({ chat }: ChatProps): React.JSX.Element | null {
  if (!chat.session) return null

  return (
    <>
      <SessionHeader chat={chat} session={chat.session} />
      <ProfileSelector chat={chat} session={chat.session} />
      <MissingCredentialMessage chat={chat} />
      <AgentTranscript chat={chat} session={chat.session} />
      <AgentComposer chat={chat} />
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
  session
}: ChatProps & { session: AgentSession }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="agent-transcript"
      role="log"
      aria-label={t('agentChat.message')}
      aria-live="polite"
    >
      {!session.messages.length && <p>{t('agentChat.empty')}</p>}
      {session.messages.map((message) => (
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

  return (
    <form className="agent-composer" onSubmit={(event) => event.preventDefault()}>
      <label>
        {t('agentChat.message')}
        <textarea
          aria-label={t('agentChat.message')}
          value={chat.draft}
          onChange={(event) => chat.setDraft(event.target.value)}
          disabled={chat.busy || chat.previewOpen}
          rows={3}
        />
      </label>
      <ComposerActions chat={chat} />
      <ComposerSources chat={chat} />
    </form>
  )
}

function ComposerActions({ chat }: ChatProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="agent-composer-actions">
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

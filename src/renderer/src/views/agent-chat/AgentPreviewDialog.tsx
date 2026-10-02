import { Button, Modal } from 'antd'
import { useTranslation } from '../../i18n'
import type {
  AgentContextEntry,
  AgentOutboundPreview,
  AgentSession
} from '@shared/agent-types'
import type { AgentChatController } from './types'

interface PreviewProps {
  chat: AgentChatController
}

export default function AgentPreviewDialog({ chat }: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Modal
      open={chat.previewOpen}
      title={t('agentChat.previewTitle')}
      onCancel={chat.closePreview}
      closable={!chat.busy}
      maskClosable={!chat.busy}
      keyboard={!chat.busy}
      width={860}
      footer={<PreviewFooter chat={chat} />}
    >
      <div className="agent-preview">
        <PreviewStatus chat={chat} />
        <PreviewOptions chat={chat} />
        <PreviewContent chat={chat} />
      </div>
    </Modal>
  )
}

function PreviewFooter({ chat }: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <Button disabled={chat.busy} onClick={chat.closePreview}>
        {t('agentChat.cancel')}
      </Button>
      <Button
        type="primary"
        loading={chat.busy}
        disabled={chat.busy || chat.previewLoading || !chat.preview}
        onClick={chat.confirmSend}
      >
        {t('agentChat.confirm')}
      </Button>
    </>
  )
}

function PreviewStatus({ chat }: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <p className="agent-hint">{t('agentChat.previewHint')}</p>
      {chat.error && <p role="alert">{chat.error}</p>}
      {chat.previewLoading && <p role="status">{t('common.loading')}</p>}
    </>
  )
}

function PreviewOptions({ chat }: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const interrupted = chat.session?.messages.filter(isInterruptedMessage) ?? []

  return (
    <>
      <label>
        <input
          type="checkbox"
          aria-label={t('agentChat.includeHistory')}
          checked={chat.includeHistory}
          disabled={chat.busy || chat.previewLoading}
          onChange={(event) => changeHistoryOption(chat, event.target.checked)}
        />
        {t('agentChat.includeHistory')}
      </label>
      {interrupted.map((message) => (
        <PartialMessageOption key={message.id} message={message} chat={chat} />
      ))}
    </>
  )
}

function isInterruptedMessage(message: AgentSession['messages'][number]): boolean {
  return message.role === 'assistant'
    && (message.status === 'user-interrupted' || message.status === 'error-interrupted')
}

function changeHistoryOption(chat: AgentChatController, includeHistory: boolean): void {
  chat.setIncludeHistory(includeHistory)
  void chat.makePreview(chat.sources, includeHistory, chat.partialIds)
}

function PartialMessageOption({
  message,
  chat
}: {
  message: AgentSession['messages'][number]
  chat: AgentChatController
}): React.JSX.Element {
  const { t } = useTranslation()
  const checked = chat.partialIds.includes(message.id)
  const disabled = chat.busy || chat.previewLoading || !chat.includeHistory

  return (
    <label>
      <input
        type="checkbox"
        aria-label={t('agentChat.partial')}
        checked={checked}
        disabled={disabled}
        onChange={(event) => changePartialOption(chat, message.id, event.target.checked)}
      />
      {t('agentChat.partial')} · {message.createdAt}
    </label>
  )
}

function changePartialOption(
  chat: AgentChatController,
  messageId: string,
  includePartial: boolean
): void {
  const next = includePartial
    ? [...chat.partialIds, messageId]
    : chat.partialIds.filter((id) => id !== messageId)
  chat.setPartialIds(next)
  void chat.makePreview(chat.sources, chat.includeHistory, next)
}

function PreviewContent({ chat }: PreviewProps): React.JSX.Element | null {
  if (!chat.preview) return null
  return <OutboundPreviewContent chat={chat} preview={chat.preview} />
}

function OutboundPreviewContent({
  chat,
  preview
}: PreviewProps & { preview: AgentOutboundPreview }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <PreviewTarget preview={preview} />
      <h3>{t('agentChat.userText')}</h3>
      <pre>{preview.message}</pre>
      <PreviewHistory preview={preview} />
      <PreviewSources chat={chat} preview={preview} />
      <h3>{t('agentChat.payload')}</h3>
      <pre data-agent-payload>{JSON.stringify(preview.messages, null, 2)}</pre>
    </>
  )
}

function PreviewTarget({ preview }: { preview: AgentOutboundPreview }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <dl>
      <dt>{t('agentChat.profile')}</dt>
      <dd>{preview.target.name} ({preview.target.id})</dd>
      <dt>{t('agentChat.destination')}</dt>
      <dd>{formatRequestUrl(preview.target.endpoint)}</dd>
      <dt>{t('agentChat.protocol')}</dt>
      <dd>{preview.target.protocol}</dd>
      <dt>{t('agentChat.model')}</dt>
      <dd>{preview.target.model}</dd>
    </dl>
  )
}

function PreviewHistory({ preview }: { preview: AgentOutboundPreview }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <h3>{t('agentChat.history')}</h3>
      {!preview.history.length && <p>{t('agentChat.noHistory')}</p>}
      {preview.history.map((message, index) => (
        <div key={`${message.messageId}-${index}`}>
          <strong>{t(`agentChat.role.${message.role}`)}</strong>
          <pre>{message.content}</pre>
        </div>
      ))}
    </>
  )
}

function PreviewSources({
  chat,
  preview
}: PreviewProps & { preview: AgentOutboundPreview }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <>
      <h3>{t('agentChat.sources')}</h3>
      {!preview.contexts.length && <p>{t('agentChat.noSources')}</p>}
      {preview.contexts.map((source) => (
        <PreviewSource key={source.path} source={source} chat={chat} />
      ))}
    </>
  )
}

function PreviewSource({
  chat,
  source
}: PreviewProps & { source: AgentContextEntry }): React.JSX.Element {
  const { t } = useTranslation()
  const removeLabel = t('agentChat.removeSource', { path: source.path })

  return (
    <section className="agent-source">
      <strong>{source.path}</strong>
      <p>{t('agentChat.version')}: {source.version}</p>
      <p>{t('agentChat.updated')}: {source.updatedAt}</p>
      <pre>{source.content}</pre>
      <Button
        aria-label={removeLabel}
        disabled={chat.busy || chat.previewLoading}
        onClick={() => revokePreviewSource(chat, source.path)}
      >
        {removeLabel}
      </Button>
    </section>
  )
}

function revokePreviewSource(chat: AgentChatController, path: string): void {
  const entries = chat.sources.filter((item) => item.path !== path)
  chat.setSources(entries)
  void chat.makePreview(entries)
}

function formatRequestUrl(endpoint: string): string {
  const url = new URL(endpoint)
  const path = url.pathname.replace(/\/$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.toString()
}

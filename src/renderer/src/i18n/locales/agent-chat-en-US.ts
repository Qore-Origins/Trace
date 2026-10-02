import type { agentChatZhCN } from './agent-chat-zh-CN'

export const agentChatEnUS: typeof agentChatZhCN = {
  nav: 'Xiao Yuan', sessions: 'Local conversations', newSession: 'New conversation', deleteSession: 'Delete conversation', deleteTitle: 'Delete conversation?',
  deleteWarning: 'This deletes the messages and provenance of this conversation. Model services are unaffected.', delete: 'Delete', cancel: 'Cancel', done: 'Done',
  noProfiles: 'Configure a model service in Settings before starting a conversation.', settings: 'Open Settings', noSession: 'Choose a conversation or start a new one.',
  empty: 'No messages yet. Only content you explicitly approve is sent.', profile: 'Model service', missingProfile: 'This conversation’s model service was removed. Choose another service.',
  missingKey: 'This service has no usable credential. Configure it in Settings before sending.', failed: 'Operation failed. Refresh and try again.', retry: 'Refresh',
  message: 'Message', user: 'You', assistant: 'Xiao Yuan', streaming: 'Replying…', incomplete: 'Reply unfinished',
  preview: 'Preview outbound content', previewTitle: 'Confirm outbound content', confirm: 'Confirm send', previewHint: 'Confirmation sends the complete content below and may incur charges.',
  destination: 'Request URL', protocol: 'Protocol', model: 'Model', userText: 'Your message', history: 'Conversation history', includeHistory: 'Include conversation history',
  partial: 'Include this interrupted reply’s partial text', sources: 'Selected sources', payload: 'Complete message payload', version: 'Version', updated: 'Updated',
  noHistory: 'No history included', noSources: 'No sources selected', removeSource: 'Remove source {{path}}', context: 'Select plans / diary',
  pickerTitle: 'Select individual context sources', browseRoot: 'Library', up: 'Parent folder', browse: 'Browse {{path}}', selectSource: 'Select {{path}}',
  folder: 'Folder (browse only)', plan: 'Plan', diary: 'Diary', pickerEmpty: 'No eligible content in this folder', localOnly: 'Selection reads local files. Nothing is uploaded before confirmation.',
  stop: 'Stop reply', exception: 'Reply interrupted by an error. Check your service or connection; sending again requires a new preview.',
  previewFailed: 'Unable to create or confirm this preview. Content or service may have changed. Preview again.', contextFailed: 'Unable to read this source. Refresh and try again.',
  role: { system: 'System', user: 'User', assistant: 'Assistant' }
}

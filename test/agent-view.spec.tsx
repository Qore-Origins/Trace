// @vitest-environment happy-dom
import { act } from 'react'
import { it, expect, afterEach, vi } from 'vitest'
import { i18n } from '../src/renderer/src/i18n'
import { useUiStore } from '../src/renderer/src/stores/ui-store'
import {
  bridge, bodies, button, check, click, compose, data, electron, end, host,
  plan, previewDraft, profile, profileId, render, responses, setProfileId, setRespond,
  renderLazyPage, renderShell, settle, startConversation, until, chunk
} from './agent-view-test-support'

afterEach(() => vi.restoreAllMocks())

function simulateWorkbenchMedia(narrow: boolean): (narrow: boolean) => Promise<void> {
  const query = '(max-width: 960px)'
  const original = window.matchMedia.bind(window)
  const media = original(query)
  Object.defineProperty(media, 'matches', { configurable: true, value: narrow })
  vi.spyOn(window, 'matchMedia').mockImplementation((value) => value === query ? media : original(value))
  return async (next) => {
    Object.defineProperty(media, 'matches', { configurable: true, value: next })
    await act(async () => media.dispatchEvent(new Event('change')))
  }
}

it('loads both conversation locales on first lazy entry and reacts to language changes', async () => {
  expect(i18n.exists('agentChat.sessions', { lng: 'zh-CN' })).toBe(false)
  expect(i18n.exists('agentChat.sessions', { lng: 'en-US' })).toBe(false)
  await render()
  expect(host.textContent).toContain('请先在设置中配置模型服务')
  expect(host.textContent).toContain('本地会话')
  await act(async () => { await i18n.changeLanguage('en-US') })
  expect(host.textContent).toContain('Configure a model service in Settings')
  expect(host.textContent).toContain('Local conversations')
  await act(async () => { await i18n.changeLanguage('zh-CN') })
  expect(host.textContent).toContain('请先在设置中配置模型服务')
})

it('reconciles a terminal event that arrives before the recovered streaming session read is delivered', async () => {
  setProfileId(await profile())
  setRespond((response) => response.write(chunk('Recovered reply')))
  await startConversation()
  await previewDraft('Question')
  await click('确认发送')
  await until(
    () => host.textContent!.includes('Recovered reply'),
    'the first SSE delta to appear after confirmation'
  )
  await renderShell()
  let release!: () => void
  electron.gate.read = new Promise<void>((resolve) => { release = resolve })
  const reads = electron.boundaries.reads
  await renderLazyPage()
  await until(() => electron.boundaries.reads > reads)
  responses[0].end(end)
  await until(() => electron.boundaries.terminals === 1)
  await act(async () => release())
  electron.gate.read = null
  await until(() => host.textContent!.includes('Recovered reply') && !host.textContent!.includes('正在回复'))
  expect(host.textContent).not.toContain('停止回复')
})

it.each(['zh-CN', 'en-US'])('guides missing profiles and missing credentials safely in %s', async (language) => {
  await i18n.changeLanguage(language); await render()
  expect(host.textContent).toContain(i18n.t('agentChat.noProfiles'))
  await click(i18n.t('agentChat.settings')); expect(useUiStore.getState().settingsOpen).toBe(true)
  setProfileId(await profile('无密钥', false))
  await act(async () => useUiStore.getState().setSettingsOpen(false))
  await until(() => !button(i18n.t('agentChat.newSession')).disabled)
  await click(i18n.t('agentChat.newSession')); await until(() => !!host.querySelector('h1'))
  expect(host.textContent).toContain(i18n.t('agentChat.missingKey'))
  await compose('private question'); expect(button(i18n.t('agentChat.preview')).disabled).toBe(true)
  expect(bodies).toEqual([])
})

it(
  'creates with the default profile, switches isolated sessions and confirms deletion without deleting profiles',
  async () => {
  await profile('备用')
  setProfileId(await profile('默认服务'))
  data(await bridge.invoke('agent:profile:setDefault', { id: profileId }))
  const old = data(await bridge.invoke('agent:session:create', { title: '旧会话', profileId }))
  await render(); await click('新建会话')
  await until(() => host.textContent!.includes('还没有消息'))
  let sessions = data(await bridge.invoke('agent:session:list'))
  const current = sessions.find((item) => item.id !== old.id)!
  expect(current.profileId).toBe(profileId)
  await until(() => !button('旧会话').disabled, 'old session button to become enabled')
  await click('旧会话')
  await until(() => host.querySelector('h1')?.textContent === '旧会话')
  expect(host.querySelector('h1')?.textContent).toBe('旧会话')
  await click('删除会话'); expect(data(await bridge.invoke('agent:session:list'))).toHaveLength(2)
  await click('删除', document.querySelector('[role="dialog"]')!)
  await until(() => host.querySelector('h1')?.textContent !== '旧会话')
  sessions = data(await bridge.invoke('agent:session:list'))
  expect(sessions.map((item) => item.id)).toEqual([current.id])
  expect(data(await bridge.invoke('agent:profile:list')).profiles).toHaveLength(2); expect(bodies).toEqual([])
})

it('keeps a single composer, draft, selection and IME alive while changing work surfaces', async () => {
  simulateWorkbenchMedia(true)
  setProfileId(await profile())
  await startConversation()
  await compose('尚未完成的草稿')
  const editor = host.querySelector('textarea')!
  await until(() => !editor.disabled, 'the composer to become editable before focusing it')
  editor.focus()
  expect(document.activeElement).toBe(editor)
  editor.setSelectionRange(2, 5)
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const pointerDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => button('工作内容').dispatchEvent(pointerDown))
  expect(pointerDown.defaultPrevented).toBe(true)
  await click('工作内容')
  expect(host.querySelectorAll('textarea')).toHaveLength(1)
  expect(host.querySelector('textarea')).toBe(editor)
  expect(editor.value).toBe('尚未完成的草稿')
  expect(editor.selectionStart).toBe(2)
  expect(editor.selectionEnd).toBe(5)
  expect(document.activeElement).toBe(editor)
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(electron.calls.some((call) => call.name === 'agent:preview:create')).toBe(false)
  await click('任务交流')
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  await until(() => !!document.querySelector('[data-agent-payload]'))
  expect(bodies).toEqual([])
})

it('links tabs to their panels, roves keyboard focus and lets pointer activation focus a tab outside the composer', async () => {
  simulateWorkbenchMedia(true)
  setProfileId(await profile())
  await startConversation()
  await until(() => !host.querySelector<HTMLTextAreaElement>('textarea')!.disabled)
  const tablist = host.querySelector('[role="tablist"]')!
  const conversation = button('任务交流', tablist)
  const work = button('工作内容', tablist)
  expect(conversation.tabIndex).toBe(0)
  expect(work.tabIndex).toBe(-1)
  for (const tab of [conversation, work]) {
    const panel = host.querySelector(`#${tab.getAttribute('aria-controls')}`)!
    expect(panel.getAttribute('role')).toBe('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab.id)
  }
  conversation.focus()
  const pointerDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  await act(async () => work.dispatchEvent(pointerDown))
  expect(pointerDown.defaultPrevented).toBe(false)
  await click('工作内容', tablist)
  expect(document.activeElement).toBe(work)
  expect(work.getAttribute('aria-selected')).toBe('true')
  expect(work.tabIndex).toBe(0)
  expect(conversation.tabIndex).toBe(-1)
  await act(async () => work.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(document.activeElement).toBe(conversation)
  expect(conversation.getAttribute('aria-selected')).toBe('true')
  expect(conversation.tabIndex).toBe(0)
  expect(work.tabIndex).toBe(-1)
  await act(async () => conversation.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(document.activeElement).toBe(work)
  expect(work.tabIndex).toBe(0)
})

it.each(['zh-CN', 'en-US'])('uses named desktop regions and switches to narrow tab semantics without replacing the composer in %s', async (language) => {
  const changeMedia = simulateWorkbenchMedia(false)
  await i18n.changeLanguage(language)
  setProfileId(await profile())
  await startConversation(i18n.t('agentChat.newSession'))
  await compose('responsive draft')
  const editor = host.querySelector<HTMLTextAreaElement>('textarea')!
  await until(() => !editor.disabled)
  editor.focus()
  editor.setSelectionRange(2, 5)
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
  const conversation = host.querySelector('#agent-conversation-surface')!
  const work = host.querySelector('#agent-work-surface')!
  const expectDesktop = (): void => {
    expect(host.querySelector('[role="tablist"]')).toBeNull()
    expect(host.querySelector('[role="tab"]')).toBeNull()
    expect(host.querySelector('[role="tabpanel"]')).toBeNull()
    for (const [panel, name] of [[conversation, 'conversation'], [work, 'workContent']] as const) {
      expect(panel.getAttribute('role')).toBe('region')
      expect(panel.getAttribute('aria-label')).toBe(i18n.t(`agentChat.${name}`))
      expect(panel.hasAttribute('aria-labelledby')).toBe(false)
      expect(panel.hasAttribute('aria-hidden')).toBe(false)
    }
  }
  expectDesktop()
  await changeMedia(true)
  expect(host.querySelectorAll('[role="tablist"]')).toHaveLength(1)
  expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(2)
  expect(conversation.getAttribute('aria-labelledby')).toBe('agent-conversation-tab')
  expect(work.getAttribute('aria-labelledby')).toBe('agent-work-tab')
  expect(button(i18n.t('agentChat.conversation')).tabIndex).toBe(0)
  expect(button(i18n.t('agentChat.workContent')).tabIndex).toBe(-1)
  await changeMedia(false)
  expectDesktop()
  expect(host.querySelector('textarea')).toBe(editor)
  expect(editor.value).toBe('responsive draft')
  expect(document.activeElement).toBe(editor)
  expect(editor.selectionStart).toBe(2)
  expect(editor.selectionEnd).toBe(5)
  await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })))
  expect(electron.calls.some((call) => call.name === 'agent:preview:create')).toBe(false)
  await act(async () => editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
})

it.each(['conversation', 'work'])('keeps the focused desktop %s control visible when switching to narrow semantics', async (surface) => {
  const changeMedia = simulateWorkbenchMedia(false)
  setProfileId(await profile())
  await startConversation()
  await until(() => !host.querySelector<HTMLTextAreaElement>('textarea')!.disabled)
  const panel = host.querySelector<HTMLElement>(`#agent-${surface}-surface`)!
  const control = button(surface === 'work' ? '执行' : '删除会话', panel)
  control.focus()
  expect(document.activeElement).toBe(control)
  await changeMedia(true)
  expect(document.activeElement).toBe(control)
  expect(panel.getAttribute('aria-hidden')).toBe('false')
  expect(host.querySelector('.agent-workbench')!.getAttribute('data-agent-surface')).toBe(surface)
})

it.each(['conversation', 'work'])('moves the focused narrow %s tab into its named desktop region', async (surface) => {
  const changeMedia = simulateWorkbenchMedia(true)
  setProfileId(await profile())
  await startConversation()
  const tab = host.querySelector<HTMLButtonElement>(`#agent-${surface}-tab`)!
  tab.focus()
  await act(async () => tab.click())
  const panel = host.querySelector<HTMLElement>(`#agent-${surface}-surface`)!
  await changeMedia(false)
  expect(document.activeElement).toBe(panel)
  expect(panel.getAttribute('role')).toBe('region')
  expect(panel.tabIndex).toBe(-1)
  expect(host.querySelector('[role="tablist"]')).toBeNull()
})

it('does not steal focus across breakpoint changes when no workbench control has focus', async () => {
  const changeMedia = simulateWorkbenchMedia(false)
  setProfileId(await profile())
  await startConversation()
  const focused = document.activeElement
  expect(focused).toBe(document.body)
  await changeMedia(true)
  expect(document.activeElement).toBe(focused)
  await changeMedia(false)
  expect(document.activeElement).toBe(focused)
})

it('shows chronological replies only for the selected request and preserves its scroll', async () => {
  setProfileId(await profile())
  await startConversation()
  await previewDraft('FIRST_REQUEST')
  await click('确认发送')
  await until(() => host.textContent!.includes('正常回复') && !host.textContent!.includes('正在回复'))
  await previewDraft('SECOND_REQUEST')
  await click('确认发送')
  await until(() => host.querySelector('.agent-transcript')!.textContent!.includes('SECOND_REQUEST'))
  expect(host.querySelector('.agent-transcript')!.textContent).not.toContain('FIRST_REQUEST')
  const choice = host.querySelector<HTMLSelectElement>('[data-agent-batch-choice]')!
  await act(async () => { choice.value = choice.options[0].value; choice.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(host.querySelector('.agent-transcript')!.textContent).toContain('FIRST_REQUEST')
  expect(host.querySelector('.agent-transcript')!.textContent).not.toContain('SECOND_REQUEST')
  await until(() => electron.boundaries.terminals === 2, 'both replies to persist before fixture teardown')
})

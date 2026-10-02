// @vitest-environment happy-dom
import { act } from 'react'
import { it, expect } from 'vitest'
import { i18n } from '../src/renderer/src/i18n'
import { useUiStore } from '../src/renderer/src/stores/ui-store'
import {
  bridge, bodies, button, check, click, compose, data, electron, end, host,
  plan, previewDraft, profile, profileId, render, responses, setProfileId, setRespond,
  renderLazyPage, renderShell, settle, startConversation, until, chunk
} from './agent-view-test-support'

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
  await click('旧会话'); expect(host.querySelector('h1')?.textContent).toBe('旧会话')
  await click('删除会话'); expect(data(await bridge.invoke('agent:session:list'))).toHaveLength(2)
  await click('删除', document.querySelector('[role="dialog"]')!)
  await until(() => host.querySelector('h1')?.textContent !== '旧会话')
  sessions = data(await bridge.invoke('agent:session:list'))
  expect(sessions.map((item) => item.id)).toEqual([current.id])
  expect(data(await bridge.invoke('agent:profile:list')).profiles).toHaveLength(2); expect(bodies).toEqual([])
})

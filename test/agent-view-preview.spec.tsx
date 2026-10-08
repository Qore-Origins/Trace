// @vitest-environment happy-dom
import { act } from 'react'
import { it, expect } from 'vitest'
import { i18n } from '../src/renderer/src/i18n'
import { useUiStore } from '../src/renderer/src/stores/ui-store'
import {
  bridge, bodies, button, check, click, compose, data, electron, end, host,
  plan, previewDraft, profile, profileId, render, responses, setProfileId, setRespond,
  renderShell, settle, startConversation, until, chunk, openPreview
} from './agent-view-test-support'

it.each(['http', 'truncated'])(
  'renders persisted exception markers and safe provider errors for %s',
  async (failure) => {
  await i18n.changeLanguage('en-US')
  setProfileId(await profile())
  setRespond((response) => {
    if (failure === 'http') {
      response.writeHead(401)
      response.end('RAW_PROVIDER_SECRET synthetic-ui-key')
      return
    }
    response.end(chunk('Retained fragment'))
  })
  await startConversation('New conversation')
  await previewDraft('Approved question')
  await click('Confirm send')
  await until(
    () => host.textContent!.includes('【异常中断】'),
    'a persisted error interruption marker after the stream ends'
  )
  expect(host.textContent).toContain('Reply interrupted by an error')
  expect(host.textContent).not.toMatch(/RAW_PROVIDER_SECRET|synthetic-ui-key/)
  const sessions = data(await bridge.invoke('agent:session:list'))
  const saved = data(await bridge.invoke('agent:session:read', { id: sessions[0].id }))
  expect(saved.messages[1].status).toBe('error-interrupted')
  if (failure === 'truncated') expect(saved.messages[1].content).toBe('Retained fragment')
  expect(bodies).toHaveLength(1)
})

it('cancels a preview that finishes after the user closes it and never dispatches its stale token', async () => {
  setProfileId(await profile())
  await startConversation()
  await compose('Delayed private question')
  let release!: () => void
  electron.gate.preview = new Promise<void>((resolve) => { release = resolve })
  await openPreview(); await until(() => electron.previewTokens.length === 1)
  expect(button('确认发送').disabled).toBe(true)
  await click('取消', document.querySelector('[role="dialog"]')!)
  await act(async () => release())
  electron.gate.preview = null
  await until(() => electron.calls.some((call) => call.name === 'agent:preview:cancel'))
  const session = data(await bridge.invoke('agent:session:list'))[0]
  const staleSend = await bridge.invoke('agent:request:send', {
    sessionId: session.id,
    token: electron.previewTokens[0]
  })
  expect(staleSend.ok).toBe(false)
  expect(bodies).toEqual([])
})

it('cancels in-flight authorization when leaving the view, then reloads local conversations on return', async () => {
  setProfileId(await profile())
  await startConversation()
  await compose('local-only until approved')
  let release!: () => void
  electron.gate.preview = new Promise<void>((resolve) => { release = resolve })
  await openPreview(); await until(() => electron.previewTokens.length === 1)
  await renderShell()
  await act(async () => release())
  electron.gate.preview = null
  await until(() => electron.calls.some((call) => call.name === 'agent:preview:cancel'))
  await render()
  expect(data(await bridge.invoke('agent:session:list'))).toHaveLength(1)
  expect(host.textContent).toContain('还没有消息')
  expect(bodies).toEqual([])
})

it(
  'selects the saved profile and refuses source-version changes after preview without a provider request',
  async () => {
  setProfileId(await profile('First'))
  const second = await profile('Second')
  await plan('one', 'old source')
  await startConversation()
  const select = host.querySelector('select')!
  await until(() => !select.disabled, 'profile selector to become available')
  await act(async () => {
    select.value = second
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await until(
    () => select.value === second && !button('选择计划 / 日记', host).disabled,
    'profile change to finish before opening context'
  )
  await click('选择计划 / 日记')
  await until(() => !!document.querySelector(
    '.agent-context-picker input[aria-label="选择 one"]'
  ))
  await check('选择 one')
  await until(() => document.body.textContent!.includes('sha256:'))
  await click('完成')
  await until(
    () => !document.querySelector('.agent-context-picker')
      && !!host.querySelector('textarea')
      && !host.querySelector('textarea')!.disabled,
    'context picker to close and message field to become editable'
  )
  await compose('source question')
  expect(host.querySelector('textarea')?.value).toBe('source question')
  await openPreview()
  await until(() => !!document.querySelector('[data-agent-payload]'))
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain('Second')
  await plan('one', 'new source')
  await click('确认发送')
  await until(() => host.textContent!.includes('无法生成或确认预览'))
  expect(bodies).toEqual([])
  expect(host.querySelector('textarea')?.value).toBe('source question')
})

it(
  'confirms visible payload, progressive SSE, session isolation, and opt-in interrupted history',
  async () => {
  setProfileId(await profile())
  setRespond((response) => response.write(chunk('PARTIAL_PRIVATE')))
  await startConversation()
  await previewDraft('第一问')
  const visible = JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)
  expect(bodies).toEqual([])
  await click('确认发送')
  await until(() => host.querySelector('.agent-transcript')!.textContent!.includes('PARTIAL_PRIVATE'))
  expect(bodies).toEqual([{ model: 'ui-model', messages: visible, stream: true }])
  const first = data(await bridge.invoke('agent:session:list'))[0]
  await click('新建会话')
  await until(() => host.querySelector('.agent-transcript')!.textContent!.includes('还没有消息'))
  responses[0].write(chunk('LATE_OLD_SESSION'))
  await settle()
  expect(host.textContent).not.toContain('LATE_OLD_SESSION')
  const rail = host.querySelector('nav')!
  const oldButton = Array.from(rail.querySelectorAll('button')).find(
    (item) => !item.hasAttribute('aria-current')
  )!
  await act(async () => oldButton.click())
  await until(() => host.textContent!.includes('LATE_OLD_SESSION'))
  await click('停止回复')
  await until(() => host.textContent!.includes('【用户中断】'))
  const saved = data(await bridge.invoke('agent:session:read', { id: first.id }))
  expect(saved.messages[1]).toMatchObject({ content: 'PARTIAL_PRIVATELATE_OLD_SESSION', status: 'user-interrupted' })
  await compose('第二问'); await openPreview(); await until(() => !!document.querySelector('[data-agent-payload]'))
  expect(document.querySelector('[data-agent-payload]')!.textContent).toContain('【用户中断】')
  expect(document.querySelector('[data-agent-payload]')!.textContent).not.toContain('PARTIAL_PRIVATE')
  await check('包含此中断回复的部分正文')
  await until(() => (
    document.querySelector('[data-agent-payload]')?.textContent?.includes('PARTIAL_PRIVATE')
      ?? false
  ))
  await check('包含同会话历史')
  await until(() => !!document.querySelector('[data-agent-payload]')
    && !document.querySelector('[data-agent-payload]')!.textContent!.includes('PARTIAL_PRIVATE'))
  expect(JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)).toEqual([
    { role: 'user', content: '第二问' }
  ])
  expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(2)
  await click('取消', document.querySelector('[role="dialog"]')!)
  expect(bodies).toHaveLength(1)
})

it(
  'browses without attaching folders, previews exact sources, recreates tokens, and cancels without HTTP',
  async () => {
  setProfileId(await profile())
  await plan('Folder/PrivatePlan', 'LOCAL_PLAN_SENTINEL')
  await plan('Diary/2026-10-02', 'LOCAL_DIARY_SENTINEL')
  await startConversation()
  await until(() => !button('选择计划 / 日记', host).disabled)
  await click('选择计划 / 日记')
  await until(() => document.body.textContent!.includes('Folder'))
  await click('浏览 Folder')
  await until(() => !!document.querySelector('input[aria-label="选择 Folder/PrivatePlan"]'))
  expect(electron.calls.filter((item) => item.name === 'agent:context:read')).toHaveLength(0)
  await check('选择 Folder/PrivatePlan'); await until(() => document.body.textContent!.includes('sha256:'))
  await click('上一级')
  await click('浏览 Diary')
  await until(() => !!document.querySelector('input[aria-label="选择 Diary/2026-10-02"]'))
  await check('选择 Diary/2026-10-02'); await until(() => document.body.textContent!.includes('LOCAL_DIARY_SENTINEL'))
  await click('完成')
  await previewDraft('请总结')
  const dialog = document.querySelector('[role="dialog"]')!
  expect(dialog.textContent).toContain('本机服务')
  expect(dialog.textContent).toContain('ui-model')
  expect(dialog.textContent).toContain('/v1/chat/completions')
  expect(dialog.textContent).toContain('LOCAL_PLAN_SENTINEL')
  expect(dialog.textContent).toContain('LOCAL_DIARY_SENTINEL')
  expect(dialog.textContent).toContain('sha256:')
  const previewCalls = electron.calls.filter((item) => item.name === 'agent:preview:create')
  const first = previewCalls.at(-1)!.payload as { selections: unknown[] }
  expect(first.selections).toEqual([
    { kind: 'plan', path: 'Folder/PrivatePlan' },
    { kind: 'diary', path: 'Diary/2026-10-02' }
  ])
  await click('移除来源 Folder/PrivatePlan', dialog)
  await until(() => !document.querySelector('[data-agent-payload]')?.textContent?.includes('LOCAL_PLAN_SENTINEL'))
  expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(1)
  expect(JSON.parse(document.querySelector('[data-agent-payload]')!.textContent!)[0].role).toBe('system')
  await click('取消', dialog)
  await settle()
  expect(bodies).toEqual([])
  expect(electron.calls.filter((item) => item.name === 'agent:preview:cancel')).toHaveLength(2)
  expect(host.textContent).not.toContain('LOCAL_PLAN_SENTINEL')
})

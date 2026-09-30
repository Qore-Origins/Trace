// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR } from '../src/shared/errors'
import type { PlanNameTemplateSettings } from '../src/shared/plan-name-templates'
import PlanNameTemplateSettingsPanel from '../src/renderer/src/components/PlanNameTemplateSettings'
import { i18n } from '../src/renderer/src/i18n'
import { useAppStore } from '../src/renderer/src/stores/app-store'
import { useUiStore } from '../src/renderer/src/stores/ui-store'

type MockResponse = { ok: true; code: 0; message: 'ok'; data: unknown } | { ok: false; code: number; message: string; data: null }
type MockBridge = {
  invoke: (channel: string, payload?: unknown) => Promise<MockResponse>
  on: () => () => void
}
type MockCall = { channel: string; payload: unknown }
type MockHandler = (channel: string, payload: unknown) => unknown | Promise<unknown>

const ROOT_A = 'D:/libraries/alpha'
const ROOT_B = 'D:/libraries/beta'
const EMPTY_SETTINGS: PlanNameTemplateSettings = { rules: [], disabled_default_paths: [] }
const ORIGINAL_ROOT = useAppStore.getState().rootDir
const ORIGINAL_SETTINGS_OPEN = useUiStore.getState().settingsOpen
const ORIGINAL_LANGUAGE = i18n.language

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let previousActEnvironment: unknown
let previousTraceDescriptor: PropertyDescriptor | undefined

function installBridge(handler: MockHandler): MockCall[] {
  const calls: MockCall[] = []
  const bridge: MockBridge = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload })
      try {
        return { ok: true, code: 0, message: 'ok', data: await handler(channel, payload) }
      } catch (error) {
        const failure = error as { code?: number; message?: string }
        return { ok: false, code: failure.code ?? 50, message: failure.message ?? 'Operation failed', data: null }
      }
    },
    on: () => () => undefined
  }
  previousTraceDescriptor = Object.getOwnPropertyDescriptor(window, 'trace')
  Object.defineProperty(window, 'trace', { configurable: true, value: bridge })
  return calls
}

function treeResponse(parentPath: string): Array<{ path: string; name: string; has_children: boolean; order: number; kind: 'folder' | 'plan' }> {
  if (parentPath === '') return [{ path: 'Planning', name: 'Planning', has_children: true, order: 0, kind: 'folder' }]
  if (parentPath === 'Planning') return [{ path: 'Planning/Deep', name: 'Deep', has_children: false, order: 0, kind: 'folder' }]
  return []
}

async function renderPanel(): Promise<void> {
  await act(async () => { root.render(createElement(PlanNameTemplateSettingsPanel)) })
}

function folderSelect(): HTMLSelectElement {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="模板文件夹"]')
  if (!select) throw new Error('Template folder selector is missing')
  return select
}

function templateInput(): HTMLInputElement {
  const input = host.querySelector<HTMLInputElement>('#plan-name-template-value')
  if (!input) throw new Error('Plan name template input is missing')
  return input
}

async function chooseFolder(parentPath: string): Promise<void> {
  await act(async () => {
    folderSelect().value = parentPath
    folderSelect().dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function enterTemplate(value: string): Promise<void> {
  const input = templateInput()
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!nativeSetter) throw new Error('Native input value setter is missing')
  await act(async () => {
    nativeSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function clickButton(label: string): Promise<void> {
  const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.trim() === label)
  if (!button) throw new Error(`Button is missing: ${label}`)
  await act(async () => { button.click() })
}

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  useAppStore.setState({ rootDir: ROOT_A })
  useUiStore.setState({ settingsOpen: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  useAppStore.setState({ rootDir: ORIGINAL_ROOT })
  useUiStore.setState({ settingsOpen: ORIGINAL_SETTINGS_OPEN })
  await i18n.changeLanguage(ORIGINAL_LANGUAGE)
  if (previousTraceDescriptor) Object.defineProperty(window, 'trace', previousTraceDescriptor)
  else Reflect.deleteProperty(window, 'trace')
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  vi.useRealTimers()
})

describe('PlanNameTemplateSettings', () => {
  it('loads nested folders and adds, edits, then removes that folder rule', async () => {
    let settings = EMPTY_SETTINGS
    const calls = installBridge(async (channel, payload) => {
      if (channel === 'plan-template:get') return settings
      if (channel === 'storage:treeGetChildren') return treeResponse((payload as { parent_path: string }).parent_path)
      if (channel === 'plan-template:set') {
        const request = payload as { parent_path: string; template: string }
        settings = {
          rules: [...settings.rules.filter((rule) => rule.parent_path !== request.parent_path), { ...request, source: 'custom' }],
          disabled_default_paths: []
        }
        return settings
      }
      if (channel === 'plan-template:remove') {
        const request = payload as { parent_path: string }
        settings = { ...settings, rules: settings.rules.filter((rule) => rule.parent_path !== request.parent_path) }
        return settings
      }
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    expect(Array.from(folderSelect().options).map((option) => option.value)).toEqual(['', 'Planning', 'Planning/Deep'])
    await chooseFolder('Planning/Deep')
    await enterTemplate('Deep_{date}_{title}')
    await clickButton('保存模板')

    expect(calls.find((call) => call.channel === 'plan-template:set')?.payload).toEqual({
      parent_path: 'Planning/Deep',
      template: 'Deep_{date}_{title}'
    })
    expect(host.textContent).toContain('Deep_')

    await enterTemplate('Review_{date}_{title}')
    await clickButton('保存模板')
    expect(calls.filter((call) => call.channel === 'plan-template:set')).toHaveLength(2)
    expect(templateInput().value).toBe('Review_{date}_{title}')

    await clickButton('移除模板')
    expect(calls.find((call) => call.channel === 'plan-template:remove')?.payload).toEqual({ parent_path: 'Planning/Deep' })
    expect(templateInput().value).toBe('')
  })

  it('shows loading and API errors without hiding the editor', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    installBridge((channel) => {
      if (channel === 'plan-template:get') return new Promise<PlanNameTemplateSettings>((_resolve, reject) => { rejectLoad = reject })
      if (channel === 'storage:treeGetChildren') return []
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    expect(host.querySelector('[role="status"]')?.textContent).toContain('加载中')
    await act(async () => { rejectLoad?.(new Error('Configuration is unreadable')) })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('读取计划名称模板失败')
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('Configuration is unreadable')
    expect(host.querySelector('select[aria-label="模板文件夹"]')).not.toBeNull()
  })

  it.each([
    { language: 'zh-CN', saveButton: '保存模板', expectedError: '计划名称模板格式无效' },
    { language: 'en-US', saveButton: 'Save template', expectedError: 'The plan name template is invalid' }
  ])('localizes validator feedback for $language without leaking backend text', async ({ language, saveButton, expectedError }) => {
    await i18n.changeLanguage(language)
    installBridge((channel, payload) => {
      if (channel === 'plan-template:get') return EMPTY_SETTINGS
      if (channel === 'storage:treeGetChildren') return treeResponse((payload as { parent_path: string }).parent_path)
      if (channel === 'plan-template:set') {
        throw Object.assign(new Error('模板只能包含日期和标题占位符'), { code: ERR.VALIDATION })
      }
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    await enterTemplate('Plan_{date}_{title}')
    await clickButton(saveButton)

    const errorText = host.querySelector('[role="alert"]')?.textContent ?? ''
    expect(errorText).toContain(expectedError)
    expect(errorText).not.toContain('模板只能包含日期和标题占位符')
  })

  it('preserves the last saved rule when edit and remove IPC calls fail', async () => {
    const savedTemplate = 'Saved_{date}_{title}'
    installBridge((channel, payload) => {
      if (channel === 'plan-template:get') {
        return {
          rules: [{ parent_path: 'Planning/Deep', template: savedTemplate, source: 'custom' }],
          disabled_default_paths: []
        } satisfies PlanNameTemplateSettings
      }
      if (channel === 'storage:treeGetChildren') return treeResponse((payload as { parent_path: string }).parent_path)
      if (channel === 'plan-template:set') throw new Error('Write is unavailable')
      if (channel === 'plan-template:remove') throw new Error('Remove is unavailable')
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    await chooseFolder('Planning/Deep')
    expect(templateInput().value).toBe(savedTemplate)

    await enterTemplate('Unsaved_{date}_{title}')
    await clickButton('保存模板')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('保存计划名称模板失败')
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('Write is unavailable')
    expect(templateInput().value).toBe('Unsaved_{date}_{title}')

    await clickButton('移除模板')
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('移除计划名称模板失败')
    expect(host.querySelector('[role="alert"]')?.textContent).not.toContain('Remove is unavailable')
    await chooseFolder('Planning')
    await chooseFolder('Planning/Deep')
    expect(templateInput().value).toBe(savedTemplate)
  })

  it('does not let a previous library load overwrite the newly active library', async () => {
    const pendingLoads: Array<(settings: PlanNameTemplateSettings) => void> = []
    installBridge((channel) => {
      if (channel === 'plan-template:get') return new Promise<PlanNameTemplateSettings>((resolve) => { pendingLoads.push(resolve) })
      if (channel === 'storage:treeGetChildren') return treeResponse('')
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    expect(pendingLoads).toHaveLength(1)
    await act(async () => { useAppStore.setState({ rootDir: ROOT_B }) })
    expect(pendingLoads).toHaveLength(2)

    const newer: PlanNameTemplateSettings = {
      rules: [{ parent_path: 'Planning', template: 'New_{title}', source: 'custom' }],
      disabled_default_paths: []
    }
    await act(async () => { pendingLoads[1]?.(newer) })
    await act(async () => { pendingLoads[0]?.({ rules: [{ parent_path: 'Planning', template: 'Old_{title}', source: 'custom' }], disabled_default_paths: [] }) })

    await chooseFolder('Planning')
    expect(templateInput().value).toBe('New_{title}')
  })

  it('reveals setting descriptions only after the two-second hover delay', async () => {
    installBridge((channel, payload) => {
      if (channel === 'plan-template:get') return EMPTY_SETTINGS
      if (channel === 'storage:treeGetChildren') return treeResponse((payload as { parent_path: string }).parent_path)
      throw new Error(`Unexpected IPC channel ${channel}`)
    })

    await renderPanel()
    const descriptionTrigger = host.querySelector<HTMLElement>('[data-template-description="true"]')
    if (!descriptionTrigger) throw new Error('Template description trigger is missing')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(async () => { descriptionTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1999) })
    expect(document.body.textContent).not.toContain('模板只支持日期和标题占位符')
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(document.body.textContent).toContain('模板只支持日期和标题占位符')
  })
})

// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ERR } from '../src/shared/errors'
import type { PlanNameTemplateSettings } from '../src/shared/plan-name-templates'
import NameDialogModal from '../src/renderer/src/components/NameDialogModal'
import { i18n } from '../src/renderer/src/i18n'
import { useAppStore } from '../src/renderer/src/stores/app-store'
import { useTreeStore } from '../src/renderer/src/stores/tree-store'
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
const TEMPLATE_SETTINGS: PlanNameTemplateSettings = {
  rules: [{ parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}', source: 'default' }],
  disabled_default_paths: []
}
const ORIGINAL_ROOT = useAppStore.getState().rootDir
const ORIGINAL_TREE_STATE = useTreeStore.getState()
const ORIGINAL_UI_STATE = useUiStore.getState()
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
        return { ok: false, code: failure.code ?? ERR.INTERNAL, message: failure.message ?? 'Operation failed', data: null }
      }
    },
    on: () => () => undefined
  }
  previousTraceDescriptor = Object.getOwnPropertyDescriptor(window, 'trace')
  Object.defineProperty(window, 'trace', { configurable: true, value: bridge })
  return calls
}

function inputWithLabel(label: string): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`) ??
    document.body.querySelector<HTMLInputElement>('[role="dialog"] input.ant-input') ??
    document.body.querySelector<HTMLInputElement>('input.ant-input')
  if (!input) throw new Error(`Dialog input is missing: ${label}`)
  return input
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((candidate) => candidate.textContent?.replace(/\s+/g, '').trim() === label)
  if (!button) throw new Error(`Dialog button is missing: ${label}`)
  return button
}

async function enterName(input: HTMLInputElement, value: string): Promise<void> {
  const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!nativeSetter) throw new Error('Native input value setter is missing')
  await act(async () => {
    nativeSetter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function renderDialog(): Promise<void> {
  await act(async () => { root.render(createElement(NameDialogModal)) })
}

function defaultHandler(channel: string, payload: unknown): unknown {
  if (channel === 'app:getAppInfo') return { rootDir: ROOT_A }
  if (channel === 'plan-template:get') return TEMPLATE_SETTINGS
  if (channel === 'storage:createPlan') {
    const request = payload as { parent_path: string; name: string }
    return { path: request.parent_path ? `${request.parent_path}/${request.name}` : request.name, name: request.name, has_children: false, order: 0, kind: 'plan' }
  }
  if (channel === 'storage:createFolder') {
    const request = payload as { parent_path: string; name: string }
    return { path: request.parent_path ? `${request.parent_path}/${request.name}` : request.name, name: request.name, has_children: false, order: 0, kind: 'folder' }
  }
  if (channel === 'storage:treeGetChildren') return []
  if (channel === 'storage:renamePlan') return { path: 'Old/Renamed' }
  throw new Error(`Unexpected IPC channel ${channel}`)
}

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  useAppStore.setState({ rootDir: ROOT_A })
  useUiStore.setState({ nameDialog: null })
  useTreeStore.setState({ childrenMap: {}, loaded: {}, expandedKeys: [], selectedPath: null, selectedKind: null })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove()
  useAppStore.setState({ rootDir: ORIGINAL_ROOT })
  useUiStore.setState({ nameDialog: ORIGINAL_UI_STATE.nameDialog, settingsOpen: ORIGINAL_UI_STATE.settingsOpen, view: ORIGINAL_UI_STATE.view })
  useTreeStore.setState({
    childrenMap: ORIGINAL_TREE_STATE.childrenMap,
    loaded: ORIGINAL_TREE_STATE.loaded,
    expandedKeys: ORIGINAL_TREE_STATE.expandedKeys,
    selectedPath: ORIGINAL_TREE_STATE.selectedPath,
    selectedKind: ORIGINAL_TREE_STATE.selectedKind
  })
  await i18n.changeLanguage(ORIGINAL_LANGUAGE)
  if (previousTraceDescriptor) Object.defineProperty(window, 'trace', previousTraceDescriptor)
  else Reflect.deleteProperty(window, 'trace')
  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  vi.useRealTimers()
})

describe('NameDialogModal plan templates', () => {
  it('previews and submits the exact expanded name when the selected folder has a rule', async () => {
    const calls = installBridge(defaultHandler)
    await act(async () => {
      useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' })
    })
    await renderDialog()
    expect(calls.some((call) => call.channel === 'plan-template:get')).toBe(true)
    const titleInput = inputWithLabel('计划标题')
    expect(titleInput.getAttribute('aria-label')).toBe('计划标题')
    await enterName(titleInput, '心情不错')

    const now = new Date()
    const localDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    expect(document.body.textContent).toContain(`Daily-Plan_${localDate}_心情不错`)

    await act(async () => { dialogButton('创建').click() })
    expect(calls.find((call) => call.channel === 'storage:createPlan')?.payload).toEqual({
      parent_path: 'Daily_Plan',
      name: `Daily-Plan_${localDate}_心情不错`
    })
    expect(useUiStore.getState().nameDialog).toBeNull()
  })

  it('refreshes the template preview at local midnight and submits the displayed date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 28, 23, 59, 58))
    const calls = installBridge(defaultHandler)
    await act(async () => {
      useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' })
    })
    await renderDialog()
    await enterName(inputWithLabel('计划标题'), '跨日计划')

    const preview = document.body.querySelector('output')
    expect(preview?.textContent).toBe('Daily-Plan_20260928_跨日计划')

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    expect(preview?.textContent).toBe('Daily-Plan_20260929_跨日计划')
    await act(async () => { dialogButton('创建').click() })
    expect(calls.find((call) => call.channel === 'storage:createPlan')?.payload).toEqual({
      parent_path: 'Daily_Plan',
      name: 'Daily-Plan_20260929_跨日计划'
    })
  })

  it('keeps a configured dialog open with localized errors for blank, invalid, and duplicate names', async () => {
    let createFailure: { code: number; message: string } | null = null
    installBridge((channel, payload) => {
      if (channel === 'storage:createPlan' && createFailure) throw Object.assign(new Error(createFailure.message), { code: createFailure.code })
      return defaultHandler(channel, payload)
    })
    await act(async () => {
      useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' })
    })
    await renderDialog()

    await act(async () => { dialogButton('创建').click() })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('标题不能为空')
    expect(useUiStore.getState().nameDialog).not.toBeNull()

    await enterName(inputWithLabel('计划标题'), 'bad/name')
    await act(async () => { dialogButton('创建').click() })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('计划名称格式无效')
    expect(useUiStore.getState().nameDialog).not.toBeNull()

    createFailure = { code: ERR.NAME_CONFLICT, message: 'duplicate' }
    await enterName(inputWithLabel('计划标题'), 'Already used')
    await act(async () => { dialogButton('创建').click() })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe('该文件夹中已有同名计划')
    expect(inputWithLabel('計畫標題').value).toBe('Already used')
    expect(useUiStore.getState().nameDialog).not.toBeNull()
  })

  it('shows accessible loading and failure states when the folder template cannot be read', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    const calls = installBridge((channel, payload) => {
      if (channel === 'plan-template:get') {
        return new Promise<PlanNameTemplateSettings>((_resolve, reject) => { rejectLoad = reject })
      }
      return defaultHandler(channel, payload)
    })
    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' }) })
    await renderDialog()
    expect(document.body.querySelector('[role="status"]')?.textContent).toContain('正在读取文件夹模板')
    expect(dialogButton('创建').disabled).toBe(true)

    await act(async () => { rejectLoad?.(new Error('Configuration is unreadable')) })
    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain('Configuration is unreadable')
    expect(dialogButton('重试加载')).not.toBeNull()
    expect(calls.some((call) => call.channel === 'storage:createPlan')).toBe(false)
  })

  it('retains legacy full-name creation when no rule applies to the selected folder', async () => {
    const calls = installBridge((channel, payload) => {
      if (channel === 'plan-template:get') return { rules: [], disabled_default_paths: [] } satisfies PlanNameTemplateSettings
      return defaultHandler(channel, payload)
    })
    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Other', initialName: '' }) })
    await renderDialog()
    await enterName(inputWithLabel('计划名称'), 'Full Legacy Name')
    await act(async () => { dialogButton('创建').click() })

    expect(calls.find((call) => call.channel === 'storage:createPlan')?.payload).toEqual({ parent_path: 'Other', name: 'Full Legacy Name' })
    expect(useUiStore.getState().nameDialog).toBeNull()
  })

  it('does not load or apply template rules to folder creation, rename, or preset saving', async () => {
    const calls = installBridge(defaultHandler)
    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'create-folder', targetPath: 'Daily_Plan', initialName: '' }) })
    await renderDialog()
    await enterName(inputWithLabel('文件夹名称'), 'Nested')
    await act(async () => { dialogButton('创建').click() })
    expect(calls.find((call) => call.channel === 'storage:createFolder')?.payload).toEqual({ parent_path: 'Daily_Plan', name: 'Nested' })
    expect(calls.some((call) => call.channel === 'plan-template:get')).toBe(false)

    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'rename', targetPath: 'Old', initialName: 'Old' }) })
    await renderDialog()
    await enterName(inputWithLabel('计划名称'), 'Renamed')
    await act(async () => { dialogButton('重命名').click() })
    expect(calls.find((call) => call.channel === 'storage:renamePlan')?.payload).toEqual({ path: 'Old', new_name: 'Renamed' })
    expect(calls.some((call) => call.channel === 'plan-template:get')).toBe(false)

    let savedPreset = ''
    await act(async () => {
      useUiStore.getState().openNameDialog({
        mode: 'preset',
        targetPath: '',
        initialName: '',
        customize: {
          titleKey: 'dialog.savePreset',
          placeholderKey: 'dialog.presetNamePlaceholder',
          okTextKey: 'dialog.saveBtn',
          validate: (name) => name ? null : 'name required',
          onSubmit: async (name) => { savedPreset = name }
        }
      })
    })
    await renderDialog()
    await enterName(inputWithLabel('预设名称…'), 'Quick Entry')
    await act(async () => { dialogButton('保存').click() })
    expect(savedPreset).toBe('Quick Entry')
    expect(calls.some((call) => call.channel === 'plan-template:get')).toBe(false)
  })

  it('does not let a previous dialog template load replace the current rule', async () => {
    const pendingLoads: Array<(settings: PlanNameTemplateSettings) => void> = []
    installBridge((channel, payload) => {
      if (channel === 'plan-template:get') return new Promise<PlanNameTemplateSettings>((resolve) => { pendingLoads.push(resolve) })
      return defaultHandler(channel, payload)
    })

    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' }) })
    await renderDialog()
    expect(pendingLoads).toHaveLength(1)

    await act(async () => {
      useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Planning', initialName: '' })
    })
    expect(pendingLoads).toHaveLength(2)

    await act(async () => { pendingLoads[0]?.({ rules: [{ parent_path: 'Daily_Plan', template: 'Old_{title}', source: 'custom' }], disabled_default_paths: [] }) })
    await enterName(inputWithLabel('计划标题'), 'Name')
    expect(document.body.textContent).not.toContain('Old_Name')

    await act(async () => { pendingLoads[1]?.({ rules: [{ parent_path: 'Planning', template: 'New_{title}', source: 'custom' }], disabled_default_paths: [] }) })
    expect(document.body.textContent).toContain('New_Name')
  })

  it('does not apply a template response from a previous active library', async () => {
    const pendingLoads: Array<(settings: PlanNameTemplateSettings) => void> = []
    installBridge((channel) => {
      if (channel === 'plan-template:get') return new Promise<PlanNameTemplateSettings>((resolve) => { pendingLoads.push(resolve) })
      return defaultHandler(channel, undefined)
    })
    await act(async () => { useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Daily_Plan', initialName: '' }) })
    await renderDialog()
    expect(pendingLoads).toHaveLength(1)

    await act(async () => { useAppStore.setState({ rootDir: ROOT_B }) })
    expect(pendingLoads).toHaveLength(2)
    await act(async () => { pendingLoads[0]?.({ rules: [{ parent_path: 'Daily_Plan', template: 'Old_{title}', source: 'custom' }], disabled_default_paths: [] }) })
    await enterName(inputWithLabel('计划标题'), 'Name')
    expect(document.body.textContent).not.toContain('Old_Name')

    await act(async () => { pendingLoads[1]?.({ rules: [{ parent_path: 'Daily_Plan', template: 'New_{title}', source: 'custom' }], disabled_default_paths: [] }) })
    expect(document.body.textContent).toContain('New_Name')
  })
})

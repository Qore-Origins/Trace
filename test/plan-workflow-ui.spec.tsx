// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import NameDialogModal from '../src/renderer/src/components/NameDialogModal'
import PlanWorkflowSettings from '../src/renderer/src/components/PlanWorkflowSettings'
import { i18n } from '../src/renderer/src/i18n'
import { useAppStore } from '../src/renderer/src/stores/app-store'
import { useTreeStore } from '../src/renderer/src/stores/tree-store'
import { useUiStore } from '../src/renderer/src/stores/ui-store'
import type { WorkflowDraftInput } from '../src/shared/plan-workflow-types'

const libraryId = '11111111111111111111111111111111'
const rootPath = 'D:/workflow-ui-test'
const empty = { format_version: '1', name_rules: [], content_templates: [], presets: [] }
const originalApp = useAppStore.getState()
const originalTree = useTreeStore.getState()
const originalUi = useUiStore.getState()
const originalLanguage = i18n.language
let host: HTMLDivElement
let root: Root
let previousTrace: PropertyDescriptor | undefined
let previousAct: unknown

interface Call { channel: string; payload: unknown }
function bridge(handler: (channel: string, payload: unknown) => unknown | Promise<unknown>): Call[] {
  const calls: Call[] = []
  previousTrace = Object.getOwnPropertyDescriptor(window, 'trace')
  Object.defineProperty(window, 'trace', { configurable: true, value: {
    invoke: async (channel: string, payload?: unknown) => {
      calls.push({ channel, payload })
      return { ok: true, code: 0, message: 'ok', data: await handler(channel, payload) }
    }, on: () => () => undefined
  } })
  return calls
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
    item.textContent?.replace(/\s+/g, '').trim() === label)
  if (!button) throw new Error(`Missing button: ${label}`)
  return button
}

async function input(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('Input setter unavailable')
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(async () => {
  previousAct = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  useAppStore.setState({ rootDir: rootPath })
  useUiStore.setState({ nameDialog: null })
  useTreeStore.setState({ childrenMap: {}, loaded: {}, expandedKeys: [], selectedPath: null, selectedKind: null })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  useAppStore.setState({ rootDir: originalApp.rootDir })
  useUiStore.setState({ nameDialog: originalUi.nameDialog })
  useTreeStore.setState({ childrenMap: originalTree.childrenMap, loaded: originalTree.loaded,
    expandedKeys: originalTree.expandedKeys, selectedPath: originalTree.selectedPath, selectedKind: originalTree.selectedKind })
  await i18n.changeLanguage(originalLanguage)
  if (previousTrace) Object.defineProperty(window, 'trace', previousTrace)
  else Reflect.deleteProperty(window, 'trace')
  if (previousAct === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct)
})

describe('plan workflow UI', () => {
  it('auto-matches a folder, requires a refreshed editable preview, creates and refreshes the tree', async () => {
    let created = false
    const calls = bridge((channel, payload) => {
      if (channel === 'plan-workflow:list') return { library_id: libraryId, config: empty, suggestions: empty }
      if (channel === 'plan-workflow:preview') {
        const draft = (payload as { draft: WorkflowDraftInput }).draft
        const name = `Projects_20261012_${draft.title ?? ''}`
        return { state: 'ready', library_id: libraryId, preset_id: 'project', revision_token: 'a'.repeat(64), outputs: [{
          key: 'main', output_id: 'main', workflow_kind: 'regular', destination_path: 'Projects', name,
          relative_path: `Projects/${name}`, name_rule_source: 'preset', target_date: '2026-10-12',
          components: [{ type: 'heading', title: '目标' }], assigned_tasks: [], conflicts: []
        }] }
      }
      if (channel === 'plan-template:get') return { rules: [], disabled_default_paths: [] }
      if (channel === 'plan-workflow:commit') { created = true; return { path: 'Projects/Projects_20261012_修改后', name: 'Projects_20261012_修改后', has_children: false, order: 0, kind: 'plan' } }
      if (channel === 'storage:treeGetChildren') return created ? [{ path: 'Projects/Projects_20261012_修改后', name: 'Projects_20261012_修改后', has_children: false, order: 0, kind: 'plan' }] : []
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await act(async () => useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Projects', initialName: '初始' }))
    await act(async () => root.render(createElement(NameDialogModal)))
    expect(document.body.textContent).toContain('Projects_20261012_初始')
    const titleInput = document.body.querySelector<HTMLInputElement>('input[value="初始"]')
    expect(titleInput).not.toBeNull()
    await input(titleInput!, '修改后')
    expect(findButton('确认创建').disabled).toBe(true)
    await act(async () => findButton('刷新预览').click())
    expect(document.body.textContent).toContain('Projects_20261012_修改后')
    await act(async () => findButton('确认创建').click())
    expect(calls.some((call) => call.channel === 'plan-workflow:commit')).toBe(true)
    expect(calls.some((call) => call.channel === 'storage:treeGetChildren')).toBe(true)
    expect(useUiStore.getState().nameDialog).toBeNull()
  })

  it('starts a configurable preset in Settings and saves it to the active library', async () => {
    const calls = bridge((channel, payload) => {
      if (channel === 'plan-workflow:list') return { library_id: libraryId, config: empty, suggestions: empty }
      if (channel === 'plan-workflow:save') return (payload as { config: unknown }).config
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await act(async () => root.render(createElement(PlanWorkflowSettings, { active: true })))
    await act(async () => findButton('新建').click())
    await act(async () => findButton('保存工作流').click())
    const save = calls.find((call) => call.channel === 'plan-workflow:save')?.payload as {
      library_id: string; config: { presets: unknown[]; content_templates: unknown[] }
    }
    expect(save.library_id).toBe(libraryId)
    expect(save.config.presets).toHaveLength(1)
    expect(save.config.content_templates).toHaveLength(1)
  })

  it('opens Settings on a workflow overview and saves an edited preset name', async () => {
    const config = {
      format_version: '1', name_rules: [],
      content_templates: [{ id: 'content', name: '基础', components: [{ type: 'heading', title: '目标' }] }],
      presets: [
        { id: 'global', name: '新工作流', scope: { kind: 'global' }, enabled: true, is_default: true,
          outputs: [{ id: 'one', destination: { kind: 'selected' }, name_template_mode: 'inherit', content_template_id: 'content', repeat: 'once' }] },
        { id: 'weekly', name: '周日联动', scope: { kind: 'category', path: 'Weekly_Plan' }, enabled: true, is_default: true,
          outputs: [{ id: 'week', destination: { kind: 'fixed', path: 'Weekly_Plan' }, name_template_mode: 'inherit', content_template_id: 'content', repeat: 'once' }] }
      ]
    }
    const calls = bridge((channel, payload) => {
      if (channel === 'plan-workflow:list') return { library_id: libraryId, config, suggestions: empty }
      if (channel === 'plan-workflow:save') return (payload as { config: unknown }).config
      throw new Error(`Unexpected channel: ${channel}`)
    })

    await act(async () => root.render(createElement(PlanWorkflowSettings, { active: true })))
    const cards = Array.from(host.querySelectorAll<HTMLElement>('.plan-workflow-settings__overview-card'))
    expect(cards).toHaveLength(2)
    expect(cards[0].textContent).toContain('全部目录')
    expect(cards[1].textContent).toContain('Weekly_Plan')
    expect(host.querySelector('input[aria-label="预设名称"]')).toBeNull()

    await act(async () => cards[1].querySelector('button')?.click())
    const nameInput = host.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')
    expect(nameInput?.value).toBe('周日联动')
    await input(nameInput!, '下一周安排')
    expect(host.querySelector('.plan-workflow-settings__editor-heading')?.textContent).toContain('下一周安排')
    await act(async () => findButton('保存工作流').click())

    const saved = calls.find((call) => call.channel === 'plan-workflow:save')?.payload as {
      config: { presets: Array<{ id: string; name: string }> }
    }
    expect(saved.config.presets.find((preset) => preset.id === 'weekly')?.name).toBe('下一周安排')
    expect(saved.config.presets.find((preset) => preset.id === 'global')?.name).toBe('新工作流')
    await act(async () => findButton('返回工作流列表').click())
    expect(host.querySelector('.plan-workflow-settings__overview-list')?.textContent).toContain('下一周安排')
    expect(host.querySelector('input[aria-label="预设名称"]')).toBeNull()

    const renamedCard = Array.from(host.querySelectorAll<HTMLElement>('.plan-workflow-settings__overview-card'))
      .find((card) => card.textContent?.includes('下一周安排'))
    await act(async () => renamedCard?.querySelector('button')?.click())
    await act(async () => findButton('复制').click())
    expect(host.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')?.value).toBe('下一周安排 副本')
  })

  it('shows an eight-file week preview and commits the batch after explicit confirmation', async () => {
    let created = false
    const calls = bridge((channel) => {
      if (channel === 'plan-workflow:list') return { library_id: libraryId, config: empty, suggestions: empty }
      if (channel === 'plan-template:get') return { rules: [], disabled_default_paths: [] }
      if (channel === 'plan-workflow:suggestPeriod') return null
      if (channel === 'plan-workflow:listBatches') return []
      if (channel === 'plan-workflow:preview') return { state: 'ready', library_id: libraryId, preset_id: 'week', revision_token: 'b'.repeat(64),
        outputs: [
          { key: 'week', output_id: 'week', workflow_kind: 'week', destination_path: 'Weekly_Plan', name: 'Weekly_Plan_period',
            relative_path: 'Weekly_Plan/Weekly_Plan_period', name_rule_source: 'preset',
            period: { start_date: '2026-10-15', end_date: '2026-10-21' }, components: [{ type: 'heading', title: '目标' }], assigned_tasks: [], conflicts: [] },
          ...Array.from({ length: 7 }, (_unused, index) => ({ key: `days:${index}`, output_id: 'days', workflow_kind: 'day',
            destination_path: 'Daily_Plan', name: `Daily_Plan_${index}`, relative_path: `Daily_Plan/Daily_Plan_${index}`,
            name_rule_source: 'preset', target_date: `2026-10-${String(index + 15).padStart(2, '0')}`,
            components: [{ type: 'task_list', title: '执行任务' }], assigned_tasks: [], conflicts: [] }))
        ] }
      if (channel === 'plan-workflow:commitBatch') { created = true; return { operation_id: 'c'.repeat(32), status: 'complete', items: [
        ...Array.from({ length: 7 }, (_unused, index) => ({ output_key: `days:${index}`, path: `Daily_Plan/Daily_Plan_${index}`,
          status: 'created', plan_id: String(index + 1).repeat(32) })),
        { output_key: 'week', path: 'Weekly_Plan/Weekly_Plan_period', status: 'created', plan_id: 'a'.repeat(32) }
      ] } }
      if (channel === 'storage:treeGetChildren') return []
      throw new Error(`Unexpected channel: ${channel}`)
    })
    await act(async () => useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: 'Weekly_Plan', initialName: '' }))
    await act(async () => root.render(createElement(NameDialogModal)))
    expect(document.body.textContent).toContain('Weekly_Plan/Weekly_Plan_period')
    expect(document.body.textContent).toContain('Daily_Plan/Daily_Plan_6')
    await act(async () => findButton('确认创建').click())
    expect(created).toBe(true)
    expect(calls.some((call) => call.channel === 'plan-workflow:commitBatch')).toBe(true)
    expect(useUiStore.getState().nameDialog).toBeNull()
  })
})

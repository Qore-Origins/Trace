import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanNameTemplateService } from '../src/main/services/plan-name-template-service'
import { PlanWorkflowConfigService } from '../src/main/services/plan-workflow-config-service'
import { PlanWorkflowResolver } from '../src/main/services/plan-workflow-resolver'
import type { PlanWorkflowConfig } from '../src/shared/plan-workflow-types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function makeConfig(): PlanWorkflowConfig {
  return {
    format_version: '1',
    name_rules: [],
    content_templates: [
      { id: 'project', name: '项目', components: [{ type: 'heading', title: '目标' }, { type: 'task_list', title: '任务' }] },
      { id: 'week', name: '周', components: [{ type: 'heading', title: '本周目标' }] },
      { id: 'day', name: '日', components: [{ type: 'task_list', title: '执行任务' }] }
    ],
    presets: [
      { id: 'project', name: '项目', scope: { kind: 'directory', path: 'Feature_Plan/Qore/Trace' }, enabled: true, is_default: true, outputs: [
        { id: 'project', destination: { kind: 'selected' }, name_template_mode: 'explicit', name_template: '{this.folder_name}_{date}_{title}', content_template_id: 'project', repeat: 'once' }
      ] },
      { id: 'weekly', name: '周日', scope: { kind: 'category', path: 'Weekly_Plan' }, enabled: true, is_default: true, outputs: [
        { id: 'week', destination: { kind: 'fixed', path: 'Weekly_Plan' }, name_template_mode: 'explicit', name_template: '{this.folder_name}_{week_start}-{week_end}', content_template_id: 'week', repeat: 'once' },
        { id: 'days', destination: { kind: 'fixed', path: 'Daily_Plan' }, name_template_mode: 'explicit', name_template: '{this.folder_name}_{date}', content_template_id: 'day', repeat: 'each_day' }
      ] }
    ]
  }
}

async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-preview-'))
  roots.push(root)
  for (const rel of ['Feature_Plan/Qore/Trace', 'Daily_Plan', 'Weekly_Plan']) {
    await fs.mkdir(join(root, rel), { recursive: true })
  }
  const repository = new PlanRepository()
  await repository.ensureLibraryRoot(root)
  const config = new PlanWorkflowConfigService(repository)
  await config.save(root, makeConfig())
  const resolver = new PlanWorkflowResolver(repository, config, new PlanNameTemplateService(repository), () => new Date(2026, 9, 11))
  return { root, repository, config, resolver }
}

describe('workflow preview resolver', () => {
  it('auto-matches the selected folder and names using the target date without writing plans', async () => {
    const { root, resolver } = await setup()
    const preview = await resolver.previewWorkflow(root, {
      selected_path: 'Feature_Plan/Qore/Trace',
      title: '迭代计划',
      target_date: '2026-10-12',
      tasks: [{ id: 'unassigned', title: '整理范围' }]
    })
    expect(preview.state).toBe('ready')
    expect(preview.preset_id).toBe('project')
    expect(preview.outputs).toMatchObject([{
      destination_path: 'Feature_Plan/Qore/Trace',
      name: 'Trace_20261012_迭代计划',
      relative_path: 'Feature_Plan/Qore/Trace/Trace_20261012_迭代计划',
      name_rule_source: 'preset',
      components: [{ type: 'heading', title: '目标' }, { type: 'task_list', title: '任务' }],
      assigned_tasks: [{ id: 'unassigned', title: '整理范围' }],
      conflicts: []
    }])
    expect((await fs.readdir(join(root, 'Feature_Plan/Qore/Trace'))).length).toBe(0)
  })

  it('expands a Thursday-to-Wednesday week across a year into one week and seven days', async () => {
    const { root, resolver } = await setup()
    const preview = await resolver.previewWorkflow(root, {
      selected_path: 'Weekly_Plan',
      period: { start_date: '2026-12-31', end_date: '2027-01-06' },
      tasks: [{ id: 'task-one', title: '整理资料', target_date: '2027-01-01' }]
    })
    expect(preview.outputs).toHaveLength(8)
    expect(preview.outputs[0].name).toBe('Weekly_Plan_20261231-20270106')
    expect(preview.outputs[1].name).toBe('Daily_Plan_20261231')
    expect(preview.outputs[2].name).toBe('Daily_Plan_20270101')
    expect(preview.outputs[7].name).toBe('Daily_Plan_20270106')
    expect(preview.outputs[2].assigned_tasks).toEqual([{ id: 'task-one', title: '整理资料', target_date: '2027-01-01' }])
    expect(preview.outputs[1].assigned_tasks).toEqual([])
  })

  it('reports existing names and same-date candidates without reusing them', async () => {
    const { root, resolver } = await setup()
    await fs.mkdir(join(root, 'Daily_Plan', '日计划-20270101-旧版'))
    await fs.mkdir(join(root, 'Daily_Plan', 'Daily_Plan_20270102'))
    const preview = await resolver.previewWorkflow(root, {
      selected_path: 'Weekly_Plan',
      period: { start_date: '2027-01-01', end_date: '2027-01-07' }
    })
    expect(preview.outputs[1].conflicts).toContainEqual(expect.objectContaining({ code: 'same_date_candidate' }))
    expect(preview.outputs[2].conflicts).toContainEqual(expect.objectContaining({ code: 'name_exists' }))
  })

  it('chooses a free sequence and changes the revision token after an external file change', async () => {
    const { root, config, resolver } = await setup()
    const changed = makeConfig()
    changed.presets[0].outputs[0].name_template = '{this.folder_name}-{date}-{sequence}'
    await config.save(root, changed)
    await fs.mkdir(join(root, 'Feature_Plan/Qore/Trace', 'Trace-20261012-01'))
    const input = { selected_path: 'Feature_Plan/Qore/Trace', target_date: '2026-10-12' }
    const before = await resolver.previewWorkflow(root, input)
    expect(before.outputs[0].name).toBe('Trace-20261012-02')
    expect((await resolver.previewWorkflow(root, input)).revision_token).toBe(before.revision_token)
    await fs.mkdir(join(root, 'Feature_Plan/Qore/Trace', 'Trace-20261012-02'))
    const after = await resolver.previewWorkflow(root, input)
    expect(after.outputs[0].name).toBe('Trace-20261012-03')
    expect(after.revision_token).not.toBe(before.revision_token)
  })

  it('recalculates edited destination, final name and component order in the revision token', async () => {
    const { root, resolver } = await setup()
    const base = { selected_path: 'Feature_Plan/Qore/Trace', target_date: '2026-10-12', title: '迭代' }
    const original = await resolver.previewWorkflow(root, base)
    const edited = await resolver.previewWorkflow(root, {
      ...base,
      destination_overrides: { project: 'Daily_Plan' },
      manual_names: { project: '自定义名称' },
      component_overrides: { project: [{ type: 'task_list', title: '今日任务' }, { type: 'note', title: '过程' }] }
    })
    expect(edited.outputs[0]).toMatchObject({ destination_path: 'Daily_Plan', name: '自定义名称',
      relative_path: 'Daily_Plan/自定义名称', name_rule_source: 'manual',
      components: [{ type: 'task_list', title: '今日任务' }, { type: 'note', title: '过程' }] })
    expect(edited.revision_token).not.toBe(original.revision_token)
    await expect(resolver.previewWorkflow(root, { ...base, destination_overrides: { project: '../outside' } })).rejects.toThrow()
    await expect(resolver.previewWorkflow(root, { ...base, component_overrides: { unknown: [] } })).rejects.toThrow()
  })

  it('returns candidate presets or no match without writing', async () => {
    const { root, config, resolver } = await setup()
    expect((await resolver.previewWorkflow(root, { selected_path: 'Daily_Plan' })).state).toBe('none')
    const changed = makeConfig()
    changed.presets.push({ ...changed.presets[0], id: 'alternative', name: '候选' })
    await expect(config.save(root, changed)).rejects.toThrow()
    expect((await resolver.previewWorkflow(root, { selected_path: 'Feature_Plan/Qore/Trace' })).state).toBe('ready')
  })

  it('rejects unsafe paths, invalid periods and missing day range', async () => {
    const { root, resolver } = await setup()
    await expect(resolver.previewWorkflow(root, { selected_path: '../outside' })).rejects.toThrow()
    await expect(resolver.previewWorkflow(root, { selected_path: 'Feature_Plan/Qore/Trace', tasks: [{ id: 'bad', title: 3 }] } as never)).rejects.toThrow()
    await expect(resolver.previewWorkflow(root, { selected_path: 'Weekly_Plan' })).rejects.toThrow()
    await expect(resolver.previewWorkflow(root, {
      selected_path: 'Weekly_Plan', period: { start_date: '2026-12-31', end_date: '2027-01-08' }
    })).rejects.toThrow()
  })
})

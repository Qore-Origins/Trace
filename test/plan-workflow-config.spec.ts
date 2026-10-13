import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PlanRepository } from '../src/main/services/plan-repository'
import { PlanNameTemplateService } from '../src/main/services/plan-name-template-service'
import { PlanWorkflowConfigService } from '../src/main/services/plan-workflow-config-service'
import { resolveNameRule, resolveWorkflowPreset } from '../src/main/services/plan-workflow-rule-service'
import { ERR } from '../src/shared/errors'
import type { PlanWorkflowConfig } from '../src/shared/plan-workflow-types'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function makeLibrary(): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-config-'))
  roots.push(root)
  for (const rel of ['Feature_Plan/Qore/Trace', 'Feature_Plan/Qore/Other', 'Daily_Plan', 'Weekly_Plan']) {
    await fs.mkdir(join(root, rel), { recursive: true })
  }
  return root
}

function config(): PlanWorkflowConfig {
  return {
    format_version: '1',
    name_rules: [
      { id: 'category-name', scope: { kind: 'category', path: 'Feature_Plan' }, enabled: true, template: '{category_name}_{date}_{title}' },
      { id: 'global-name', scope: { kind: 'global' }, enabled: true, template: '{date}_{title}' }
    ],
    content_templates: [{ id: 'basic', name: '基础', components: [{ type: 'heading', title: '目标' }] }],
    presets: [
      { id: 'exact', name: 'Trace', scope: { kind: 'directory', path: 'Feature_Plan/Qore/Trace' }, enabled: true, is_default: true, outputs: [{ id: 'single', destination: { kind: 'selected' }, name_template_mode: 'inherit', content_template_id: 'basic', repeat: 'once' }] },
      { id: 'category', name: '功能', scope: { kind: 'category', path: 'Feature_Plan' }, enabled: true, is_default: true, outputs: [{ id: 'single', destination: { kind: 'selected' }, name_template_mode: 'inherit', content_template_id: 'basic', repeat: 'once' }] },
      { id: 'global', name: '通用', scope: { kind: 'global' }, enabled: true, is_default: true, outputs: [{ id: 'single', destination: { kind: 'selected' }, name_template_mode: 'inherit', content_template_id: 'basic', repeat: 'once' }] }
    ]
  }
}

describe('workflow config and rule resolution', () => {
  it('matches exact, category and global defaults in order without persisting suggestions', async () => {
    const root = await makeLibrary()
    const service = new PlanWorkflowConfigService(new PlanRepository())
    expect((await service.load(root)).presets).toEqual([])
    expect(await fs.readdir(root)).not.toContain('.trace')
    expect(service.suggestions().presets.map((preset) => preset.id)).toEqual([
      'current-folder', 'project', 'future', 'week-and-days'
    ])
    const saved = await service.save(root, config())
    expect(resolveWorkflowPreset(saved, 'Feature_Plan/Qore/Trace')).toEqual({ kind: 'matched', preset: saved.presets[0] })
    expect(resolveWorkflowPreset(saved, 'Feature_Plan/Qore/Other')).toEqual({ kind: 'matched', preset: saved.presets[1] })
    expect(resolveWorkflowPreset(saved, 'Daily_Plan')).toEqual({ kind: 'matched', preset: saved.presets[2] })
  })

  it('reports same-tier candidates and falls back when defaults are disabled', () => {
    const value = config()
    value.presets.push({ ...value.presets[0], id: 'same-tier', name: '候选' })
    expect(resolveWorkflowPreset(value, 'Feature_Plan/Qore/Trace')).toEqual({
      kind: 'candidates',
      presets: [value.presets[0], value.presets[3]]
    })
    value.presets.forEach((preset) => { preset.enabled = false })
    expect(resolveWorkflowPreset(value, 'Feature_Plan/Qore/Trace')).toEqual({ kind: 'none' })
    expect(() => resolveWorkflowPreset(value, '../outside')).toThrow()
  })

  it('resolves legacy exact overrides before enabled category and global rules, then built-ins', async () => {
    const root = await makeLibrary()
    const legacyService = new PlanNameTemplateService(new PlanRepository())
    const value = config()
    await legacyService.set(root, 'Feature_Plan/Qore/Trace', 'Legacy_{title}')
    let legacy = await legacyService.get(root)
    expect(resolveNameRule(value, legacy, 'Feature_Plan/Qore/Trace')).toEqual({ template: 'Legacy_{title}', source: 'legacy-custom' })
    expect(resolveNameRule(value, legacy, 'Feature_Plan/Qore/Other')).toEqual({ template: '{category_name}_{date}_{title}', source: 'category', ruleId: 'category-name' })
    expect(resolveNameRule(value, legacy, 'Daily_Plan')).toEqual({ template: '{date}_{title}', source: 'global', ruleId: 'global-name' })
    value.name_rules[1].enabled = false
    expect(resolveNameRule(value, legacy, 'Daily_Plan')).toEqual({ template: 'Daily-Plan_{date}_{title}', source: 'built-in' })
    await legacyService.remove(root, 'Daily_Plan')
    legacy = await legacyService.get(root)
    expect(resolveNameRule(value, legacy, 'Daily_Plan')).toEqual({ template: null, source: 'manual' })
  })

  it('keeps libraries separate and preserves malformed config on a rejected save', async () => {
    const first = await makeLibrary()
    const second = await makeLibrary()
    const service = new PlanWorkflowConfigService(new PlanRepository())
    await service.save(first, config())
    expect((await service.load(second)).presets).toEqual([])
    const path = join(first, '.trace', 'plan-workflows.json')
    await fs.writeFile(path, '{broken', 'utf8')
    await expect(service.load(first)).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    await expect(service.save(first, config())).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    expect(await fs.readFile(path, 'utf8')).toBe('{broken')
  })

  it('rejects unsafe paths, duplicate defaults and missing template references', async () => {
    const root = await makeLibrary()
    const service = new PlanWorkflowConfigService(new PlanRepository())
    const duplicate = config()
    duplicate.presets.push({ ...duplicate.presets[0], id: 'duplicate' })
    await expect(service.save(root, duplicate)).rejects.toMatchObject({ code: ERR.VALIDATION })
    const missing = config()
    missing.presets[0].outputs[0].content_template_id = 'missing'
    await expect(service.save(root, missing)).rejects.toMatchObject({ code: ERR.VALIDATION })
    const unsafe = config()
    unsafe.presets[0].scope = { kind: 'directory', path: '../outside' }
    await expect(service.save(root, unsafe)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    const hidden = config()
    hidden.presets[0].scope = { kind: 'directory', path: '.trace' }
    await expect(service.save(root, hidden)).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(fs.access(join(root, '.trace', 'plan-workflows.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes a default preset without leaving its binding', async () => {
    const root = await makeLibrary()
    const service = new PlanWorkflowConfigService(new PlanRepository())
    await service.save(root, config())
    const next = await service.removePreset(root, 'exact')
    expect(resolveWorkflowPreset(next, 'Feature_Plan/Qore/Trace')).toEqual({ kind: 'matched', preset: next.presets[0] })
  })
})

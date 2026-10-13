import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ERR } from '../src/shared/errors'
import type { PlanWorkflowConfig, WorkflowDraftInput } from '../src/shared/plan-workflow-types'
import { PlanRepository } from '../src/main/services/plan-repository'
import { StorageService } from '../src/main/services/storage-service'
import { PlanNameTemplateService } from '../src/main/services/plan-name-template-service'
import { PlanWorkflowConfigService } from '../src/main/services/plan-workflow-config-service'
import { PlanWorkflowResolver } from '../src/main/services/plan-workflow-resolver'
import { PlanWorkflowService } from '../src/main/services/plan-workflow-service'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))) })

function config(): PlanWorkflowConfig {
  return { format_version: '1', name_rules: [], content_templates: [
    { id: 'basic', name: '基础', components: [{ type: 'heading', title: '目标' }, { type: 'task_list', title: '任务' }] }
  ], presets: [
    { id: 'project', name: '项目', scope: { kind: 'directory', path: 'Projects' }, enabled: true, is_default: true,
      outputs: [{ id: 'main', destination: { kind: 'selected' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{date}_{title}', content_template_id: 'basic', repeat: 'once' }] }
  ] }
}

async function setup() {
  const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-service-'))
  roots.push(root)
  await fs.mkdir(join(root, 'Projects'))
  const repository = new PlanRepository()
  await repository.ensureLibraryRoot(root)
  const storage = new StorageService(repository)
  storage.setRoot(root)
  const configs = new PlanWorkflowConfigService(repository)
  await configs.save(root, config())
  const resolver = new PlanWorkflowResolver(repository, configs, new PlanNameTemplateService(repository), () => new Date(2026, 9, 11))
  const service = new PlanWorkflowService(storage, repository, configs, resolver)
  const listed = await service.list()
  const draft: WorkflowDraftInput = { selected_path: 'Projects', title: '迭代', target_date: '2026-10-12', tasks: [{ id: 'task1', title: '整理需求' }] }
  return { root, storage, service, draft, libraryId: listed.library_id }
}

describe('plan workflow service', () => {
  it('previews without writing, then creates the exact single plan with ordered components and tasks', async () => {
    const { root, service, draft, libraryId } = await setup()
    const preview = await service.preview({ library_id: libraryId, draft })
    expect(preview.state).toBe('ready')
    expect(preview.outputs[0].relative_path).toBe('Projects/Projects_20261012_迭代')
    expect(await fs.readdir(join(root, 'Projects'))).toEqual([])
    const node = await service.commit({ library_id: libraryId, draft, revision_token: preview.revision_token })
    expect(node.path).toBe('Projects/Projects_20261012_迭代')
    const document = JSON.parse(await fs.readFile(join(root, 'Projects', node.name, 'plan.json'), 'utf8')) as {
      plan_id: string; components: Array<{ type: string; payload: { items?: Array<{ title: string; status: string }> } }>
    }
    expect(document.plan_id).toMatch(/^[a-f0-9]{32}$/)
    expect(document.components.map((component) => component.type)).toEqual(['heading', 'task_list'])
    expect(document.components[1].payload.items).toMatchObject([{ title: '整理需求', status: 'not_started' }])
  })

  it('rejects stale previews, changed destinations, a switched library, and name conflicts', async () => {
    const { root, storage, service, draft, libraryId } = await setup()
    const preview = await service.preview({ library_id: libraryId, draft })
    await expect(service.commit({ library_id: libraryId, draft, revision_token: '0'.repeat(64) })).rejects.toMatchObject({ code: ERR.CONFLICT })
    await fs.mkdir(join(root, 'Projects', 'external'))
    await expect(service.commit({ library_id: libraryId, draft, revision_token: preview.revision_token })).rejects.toMatchObject({ code: ERR.CONFLICT })
    const fresh = await service.preview({ library_id: libraryId, draft })
    await fs.mkdir(join(root, 'Projects', 'Projects_20261012_迭代'))
    await expect(service.commit({ library_id: libraryId, draft, revision_token: fresh.revision_token })).rejects.toMatchObject({ code: ERR.CONFLICT })
    const other = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-other-'))
    roots.push(other)
    const repository = new PlanRepository()
    await repository.ensureLibraryRoot(other)
    storage.setRoot(other)
    await expect(service.preview({ library_id: libraryId, draft })).rejects.toMatchObject({ code: ERR.CONFLICT })
    await expect(service.commit({ library_id: libraryId, draft, revision_token: preview.revision_token })).rejects.toMatchObject({ code: ERR.CONFLICT })
  })

  it('preserves legacy creation when no preset matches and refuses malformed requests', async () => {
    const { root, service, libraryId } = await setup()
    expect((await service.preview({ library_id: libraryId, draft: { selected_path: '' } })).state).toBe('none')
    await expect(service.preview({ library_id: libraryId, draft: { selected_path: '../outside' } })).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(service.commit({ library_id: libraryId, draft: { selected_path: '' }, revision_token: 'x' })).rejects.toMatchObject({ code: ERR.VALIDATION })
    expect(await fs.readdir(join(root, 'Projects'))).toEqual([])
  })
})

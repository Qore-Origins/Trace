import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PlanWorkflowConfig } from '../src/shared/plan-workflow-types'

const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  return {
    handlers,
    ipcMain: {
      handle: vi.fn((name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => handlers.set(name, handler)),
      removeHandler: vi.fn((name: string) => handlers.delete(name))
    },
    ipcRenderer: { invoke: vi.fn(async (name: string, payload?: unknown) => handlers.get(name)?.({}, payload)), on: vi.fn(), removeListener: vi.fn() },
    contextBridge: { exposeInMainWorld: vi.fn() },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }
  }
})

vi.mock('electron', () => ({
  ipcMain: electron.ipcMain, ipcRenderer: electron.ipcRenderer,
  contextBridge: electron.contextBridge, dialog: electron.dialog
}))

interface Bridge { invoke: (channel: string, payload?: unknown) => Promise<unknown> }
const roots: string[] = []
let dispose: (() => void) | undefined

beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); electron.handlers.clear() })
afterEach(async () => {
  dispose?.(); dispose = undefined
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

function presetConfig(): PlanWorkflowConfig {
  return {
    format_version: '1', name_rules: [],
    content_templates: [{ id: 'basic', name: '基础', components: [{ type: 'heading', title: '目标' }] }],
    presets: [{ id: 'folder', name: '目录计划', scope: { kind: 'directory', path: 'Projects' }, enabled: true, is_default: true,
      outputs: [{ id: 'one', destination: { kind: 'selected' }, name_template_mode: 'explicit',
        name_template: '{this.folder_name}_{date}_{title}', content_template_id: 'basic', repeat: 'once' }] }]
  }
}

describe('plan workflow IPC boundary', () => {
  it('exposes exactly the workflow channels and rejects unknown workflow channels', async () => {
    await import('../src/preload/index')
    const bridge = electron.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    const allowed = ['list', 'save', 'remove', 'preview', 'suggestPeriod', 'commit', 'commitBatch', 'resumeBatch', 'listBatches']
    for (const action of allowed) await bridge.invoke(`plan-workflow:${action}`)
    const blocked = await bridge.invoke('plan-workflow:readFile', { path: 'C:/outside' })
    expect(electron.ipcRenderer.invoke.mock.calls.map(([channel]) => channel)).toEqual(allowed.map((action) => `plan-workflow:${action}`))
    expect(blocked).toEqual({ ok: false, code: 50, message: '通道未开放', data: null })
  })

  it('binds preview and commit to the active library and returns a created node', async () => {
    const [{ registerIpc }, { PlanRepository }, { StorageService }, { PlanNameTemplateService },
      { PlanWorkflowConfigService }, { PlanWorkflowResolver }, { PlanWorkflowService }] = await Promise.all([
      import('../src/main/ipc/register'), import('../src/main/services/plan-repository'),
      import('../src/main/services/storage-service'), import('../src/main/services/plan-name-template-service'),
      import('../src/main/services/plan-workflow-config-service'), import('../src/main/services/plan-workflow-resolver'),
      import('../src/main/services/plan-workflow-service')
    ])
    await import('../src/preload/index')
    const bridge = electron.contextBridge.exposeInMainWorld.mock.calls.at(-1)?.[1] as Bridge
    const root = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-ipc-'))
    roots.push(root)
    await fs.mkdir(join(root, 'Projects'))
    const repository = new PlanRepository()
    await repository.ensureLibraryRoot(root)
    const storage = new StorageService(repository)
    storage.setRoot(root)
    const templates = new PlanNameTemplateService(repository)
    const configs = new PlanWorkflowConfigService(repository)
    const resolver = new PlanWorkflowResolver(repository, configs, templates, () => new Date(2026, 9, 11))
    const workflows = new PlanWorkflowService(storage, repository, configs, resolver)
    const startup = {
      waitForRootActivation: async () => undefined, waitForBootstrap: async () => undefined,
      getRootActivationStatus: () => 'active', runAfterRootActivation: (operation: () => unknown) => Promise.resolve().then(operation),
      markRootActivated: vi.fn(), onWindowShown: vi.fn()
    }
    dispose = registerIpc({ app: {}, storage, config: {}, transfer: {}, export: {}, search: {},
      planNameTemplates: templates, planWorkflows: workflows, startup, getWindow: () => null, log: vi.fn()
    } as unknown as Parameters<typeof registerIpc>[0])

    const listed = await bridge.invoke('plan-workflow:list') as { ok: boolean; data: { library_id: string } }
    expect(listed.ok).toBe(true)
    const libraryId = listed.data.library_id
    const saved = await bridge.invoke('plan-workflow:save', { library_id: libraryId, config: presetConfig() }) as { ok: boolean }
    expect(saved.ok).toBe(true)
    const draft = { selected_path: 'Projects', title: '迭代', target_date: '2026-10-12' }
    const preview = await bridge.invoke('plan-workflow:preview', { library_id: libraryId, draft }) as {
      ok: boolean; data: { revision_token: string; outputs: Array<{ name: string }> }
    }
    expect(preview.data.outputs[0].name).toBe('Projects_20261012_迭代')
    const stale = await bridge.invoke('plan-workflow:commit', { library_id: libraryId, draft, revision_token: '0'.repeat(64) }) as { ok: boolean; code: number }
    expect(stale).toMatchObject({ ok: false, code: 22 })
    const created = await bridge.invoke('plan-workflow:commit', { library_id: libraryId, draft, revision_token: preview.data.revision_token }) as {
      ok: boolean; data: { path: string }
    }
    expect(created.data.path).toBe('Projects/Projects_20261012_迭代')
    const other = await fs.mkdtemp(join(tmpdir(), 'trace-workflow-ipc-other-'))
    roots.push(other)
    await repository.ensureLibraryRoot(other)
    storage.setRoot(other)
    const rejected = await bridge.invoke('plan-workflow:preview', { library_id: libraryId, draft }) as { ok: boolean; code: number }
    expect(rejected).toMatchObject({ ok: false, code: 22 })
  })
})

import { promises as fs } from 'node:fs'
import { posix, win32 } from 'node:path'
import { ERR, TraceError } from '../../shared/errors'
import type { WorkspaceTabsState } from '../../shared/workspace-tabs-types'
import { normalizeRel } from '../../shared/path-utils'
import { assertRealPathWithinRoot, resolveWithin } from './path-safety'
import { PlanRepository } from './plan-repository'

const TABS_FILE = '.trace/workspace-tabs.json'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidConfig(): TraceError {
  return new TraceError(ERR.FORMAT_INVALID, '计划标签配置损坏，原文件已保留')
}

function normalizePlanPath(root: string, value: unknown): string {
  if (typeof value !== 'string') throw new TraceError(ERR.VALIDATION, '计划路径必须为文本')
  if (posix.isAbsolute(value) || win32.isAbsolute(value)) {
    throw new TraceError(ERR.PATH_UNSAFE, '计划路径必须是库内相对路径')
  }
  const normalized = normalizeRel(value)
  if (!normalized || normalized.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TraceError(ERR.PATH_UNSAFE, '计划路径无效')
  }
  return resolveWithin(root, normalized).rel
}

export class WorkspaceTabsService {
  constructor(
    private readonly repo: PlanRepository,
    private readonly getRoot: () => string | null
  ) {}

  async load(): Promise<WorkspaceTabsState> {
    const { root, libraryId } = await this.activeLibrary()
    const state = await this.readStored(root)
    if (!state || state.library_id !== libraryId) return this.empty(libraryId)
    return this.filterExisting(root, state)
  }

  async save(state: WorkspaceTabsState): Promise<void> {
    const { root, libraryId } = await this.activeLibrary()
    if (!isRecord(state) || state.library_id !== libraryId) {
      throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新加载标签')
    }
    if (!Array.isArray(state.open_paths) || (state.active_path !== null && typeof state.active_path !== 'string')) {
      throw new TraceError(ERR.VALIDATION, '计划标签状态无效')
    }

    const paths = new Set<string>()
    const openPaths: WorkspaceTabsState['open_paths'] = []
    for (const item of state.open_paths) {
      if (!isRecord(item)) throw new TraceError(ERR.VALIDATION, '计划标签无效')
      const path = normalizePlanPath(root, item.path)
      if (paths.has(path)) throw new TraceError(ERR.VALIDATION, '计划标签路径重复')
      if (item.plan_id !== undefined && (typeof item.plan_id !== 'string' || !item.plan_id)) {
        throw new TraceError(ERR.VALIDATION, '计划身份无效')
      }
      paths.add(path)
      openPaths.push(item.plan_id === undefined ? { path } : { path, plan_id: item.plan_id })
    }
    const activePath = state.active_path === null ? null : normalizePlanPath(root, state.active_path)
    if (activePath !== null && !paths.has(activePath)) {
      throw new TraceError(ERR.VALIDATION, '活动计划不在标签列表中')
    }

    // Read first: malformed configuration must never be replaced by a valid save.
    await this.readStored(root)
    const next = await this.filterExisting(root, { library_id: libraryId, open_paths: openPaths, active_path: activePath })
    if (this.getRoot() !== root) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新加载标签')
    const target = resolveWithin(root, TABS_FILE).abs
    await assertRealPathWithinRoot(root, target, { allowMissing: true })
    await this.repo.writeAppJson(target, next)
  }

  private async activeLibrary(): Promise<{ root: string; libraryId: string }> {
    const root = this.getRoot()
    if (!root) throw new TraceError(ERR.STATE_MACHINE, '计划库根目录未初始化')
    const meta = await this.repo.readLibraryMeta(root)
    if (typeof meta.library_id !== 'string' || !meta.library_id) throw invalidConfig()
    return { root, libraryId: meta.library_id }
  }

  private empty(libraryId: string): WorkspaceTabsState {
    return { library_id: libraryId, open_paths: [], active_path: null }
  }

  private async readStored(root: string): Promise<WorkspaceTabsState | null> {
    const target = resolveWithin(root, TABS_FILE).abs
    await assertRealPathWithinRoot(root, target, { allowMissing: true })
    let raw: string
    try {
      raw = await fs.readFile(target, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidConfig()
    }
    if (!isRecord(parsed) || (parsed.library_id !== undefined && typeof parsed.library_id !== 'string') ||
      !Array.isArray(parsed.open_paths) || (parsed.active_path !== null && typeof parsed.active_path !== 'string')) {
      throw invalidConfig()
    }
    if (!parsed.open_paths.every((item) => isRecord(item) && typeof item.path === 'string' &&
      (item.plan_id === undefined || typeof item.plan_id === 'string'))) {
      throw invalidConfig()
    }
    return parsed as unknown as WorkspaceTabsState
  }

  private async filterExisting(root: string, state: WorkspaceTabsState): Promise<WorkspaceTabsState> {
    const seen = new Set<string>()
    const openPaths: WorkspaceTabsState['open_paths'] = []
    for (const item of state.open_paths) {
      let path: string
      try {
        path = normalizePlanPath(root, item.path)
        if (seen.has(path)) continue
        const directory = resolveWithin(root, path).abs
        await assertRealPathWithinRoot(root, directory)
        if (!await this.repo.hasPlanFile(root, path)) continue
        await assertRealPathWithinRoot(root, this.repo.planFileAbs(root, path))
      } catch (error) {
        if (!(error instanceof TraceError) ||
          (error.code !== ERR.PATH_NOT_FOUND && error.code !== ERR.PATH_UNSAFE)) {
          throw error
        }
        continue
      }
      seen.add(path)
      openPaths.push(item.plan_id === undefined ? { path } : { path, plan_id: item.plan_id })
    }
    let activePath: string | null = null
    if (state.active_path !== null) {
      try {
        const normalized = normalizePlanPath(root, state.active_path)
        if (seen.has(normalized)) activePath = normalized
      } catch {
        // A stale or unsafe active path is never restored.
      }
    }
    return { library_id: state.library_id, open_paths: openPaths, active_path: activePath }
  }
}

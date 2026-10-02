import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { AgentContextEntry, AgentContextSelection } from '../../shared/agent-types'
import type { PlanTreeNode } from '../../shared/ipc-contract'
import { DIARY_DIR } from '../../shared/plan-types'
import { ERR, TraceError } from '../../shared/errors'
import { agentRecord } from './agent-session-repository'
import { assertRealPathWithinRoot, normalizeRelSafe, resolveWithin } from './path-safety'
import type { StorageService } from './storage-service'

const MAX_CONTEXT_BYTES = 1024 * 1024
const MAX_PATH_LENGTH = 2048
const DIARY_PATH_PATTERN = new RegExp(`^${DIARY_DIR}/\\d{4}-\\d{2}-\\d{2}$`, process.platform === 'win32' ? 'i' : '')
export function parseContextSelection(value: unknown): AgentContextSelection {
  if (!agentRecord(value) || (value.kind !== 'plan' && value.kind !== 'diary') || typeof value.path !== 'string' || !value.path || value.path.length > MAX_PATH_LENGTH) throw new TraceError(ERR.VALIDATION, '上下文条目无效')
  const path = normalizeRelSafe(value.path)
  if (!path || path.split('/').some((part) => part === '.' || part === '')) throw new TraceError(ERR.VALIDATION, '上下文条目无效')
  if (value.kind === 'diary' && !DIARY_PATH_PATTERN.test(path)) throw new TraceError(ERR.VALIDATION, '日记条目无效')
  return { kind: value.kind, path }
}
export class AgentContextService {
  constructor(private readonly storage: StorageService) {}
  private root(): string {
    const root = this.storage.getRootAbs()
    if (!root) throw new TraceError(ERR.STATE_MACHINE, '请先打开计划库')
    return root
  }
  async browse(parentPath: unknown): Promise<PlanTreeNode[]> {
    if (typeof parentPath !== 'string' || parentPath.length > MAX_PATH_LENGTH) throw new TraceError(ERR.VALIDATION, '上下文目录无效')
    const root = this.root()
    const parent = resolveWithin(root, parentPath)
    await assertRealPathWithinRoot(root, parent.abs)
    const nodes = await this.storage.treeGetChildren(parent.rel)
    const safe: PlanTreeNode[] = []
    for (const node of nodes) {
      try {
        const child = resolveWithin(root, node.path)
        await assertRealPathWithinRoot(root, child.abs)
        if (node.kind === 'plan') await assertRealPathWithinRoot(root, join(child.abs, 'plan.json'))
        safe.push(node)
      } catch (error) {
        if (!(error instanceof TraceError) || (error.code !== ERR.PATH_UNSAFE && error.code !== ERR.PATH_NOT_FOUND)) throw error
      }
    }
    if (this.root() !== root) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新选择')
    return safe
  }
  async read(input: unknown): Promise<AgentContextEntry> {
    return (await this.readResolved(input)).entry
  }
  async readResolved(input: unknown): Promise<{ entry: AgentContextEntry; sourceIdentity: string }> {
    const selection = parseContextSelection(input)
    const root = this.root()
    const path = resolveWithin(root, selection.path)
    const file = join(path.abs, 'plan.json')
    await assertRealPathWithinRoot(root, file)
    const rootReal = await fs.realpath(root)
    const fileReal = await fs.realpath(file)
    const sourcePath = normalizeRelSafe(relative(rootReal, dirname(fileReal)))
    const sourceKind = DIARY_PATH_PATTERN.test(sourcePath) ? 'diary' : 'plan'
    if (selection.kind !== sourceKind) throw new TraceError(ERR.VALIDATION, '上下文条目类型与来源不符')
    if ((await fs.stat(file)).size > MAX_CONTEXT_BYTES) throw new TraceError(ERR.VALIDATION, '上下文条目过大')
    const document = await this.storage.readPlan(path.rel)
    if (typeof document.updated_at !== 'string' || !Number.isFinite(Date.parse(document.updated_at))) throw new TraceError(ERR.FORMAT_INVALID, '上下文版本无效')
    const content = JSON.stringify(document, null, 2)
    if (Buffer.byteLength(content) > MAX_CONTEXT_BYTES) throw new TraceError(ERR.VALIDATION, '上下文条目过大')
    const libraryId = createHash('sha256').update(rootReal).digest('hex')
    if (this.root() !== root) throw new TraceError(ERR.CONFLICT, '计划库已切换，请重新选择')
    const sourceFile = normalizeRelSafe(relative(rootReal, fileReal))
    const sourceIdentity = `${libraryId}:${process.platform === 'win32' ? sourceFile.toLowerCase() : sourceFile}`
    const entry: AgentContextEntry = { kind: selection.kind, path: path.rel, libraryId, updatedAt: document.updated_at, version: `sha256:${createHash('sha256').update(content).digest('hex')}`, content }
    return { entry, sourceIdentity }
  }
}

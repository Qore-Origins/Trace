// WatchService：计划库外部变更监视（chokidar）
// 职责：外部改动 → 缓存失效 + fs-external-change 事件；自身写入回声抑制
import chokidar from 'chokidar'
import { join } from 'node:path'
import { bus } from './event-bus'
import type { TreeCache } from './tree-cache'

export class WatchService {
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private root: string | null = null
  // 自身写入抑制：absPath → 时间戳（500ms 内的事件忽略）
  private suppress = new Map<string, number>()

  constructor(private treeCache: TreeCache) {}

  start(rootAbs: string): void {
    this.stop()
    this.root = rootAbs
    this.watcher = chokidar.watch(rootAbs, {
      ignoreInitial: true,
      ignored: (p) => p.includes('node_modules'),
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
    })

    const handle = (absPath: string, type: 'created' | 'changed' | 'removed'): void => {
      if (this.isSuppressed(absPath)) return
      // 计划树失效：变更文件的父目录（plan.json 变更）或新建/删除的目录链
      const rel = toRel(rootAbs, absPath)
      if (rel !== null) this.treeCache.invalidatePrefix(parentDirOf(rel))
      bus.emit('trace:fs-external-change', { paths: rel ? [rel] : [], type })
    }

    this.watcher
      .on('add', (p: string) => handle(p, 'created'))
      .on('change', (p: string) => handle(p, 'changed'))
      .on('unlink', (p: string) => handle(p, 'removed'))
      .on('addDir', (p: string) => handle(p, 'created'))
      .on('unlinkDir', (p: string) => handle(p, 'removed'))
      .on('error', (e: unknown) => console.error('[watch] error', e))
  }

  stop(): void {
    void this.watcher?.close()
    this.watcher = null
    this.root = null
    this.suppress.clear()
  }

  // Repository 原子写回调：写入前后登记，抑制回声
  markInternalWrite(absPath: string): void {
    this.suppress.set(absPath, Date.now())
    this.suppress.set(join(absPath, 'plan.json'), Date.now())
    if (this.suppress.size > 500) this.prune()
  }

  private isSuppressed(absPath: string): boolean {
    const now = Date.now()
    for (const [key, ts] of this.suppress) {
      if (now - ts > 500) this.suppress.delete(key)
    }
    // 命中精确路径，或位于被标记的目录内（原子写 tmp→rename 场景）
    for (const [key, ts] of this.suppress) {
      if ((absPath === key || absPath.startsWith(key + '\\') || absPath.startsWith(key + '/')) && now - ts <= 500) {
        return true
      }
    }
    return false
  }

  private prune(): void {
    const now = Date.now()
    for (const [key, ts] of this.suppress) {
      if (now - ts > 500) this.suppress.delete(key)
    }
  }
}

function toRel(rootAbs: string, absPath: string): string | null {
  if (!absPath.startsWith(rootAbs)) return null
  const rest = absPath.slice(rootAbs.length).replace(/^[\\/]/, '')
  return rest === '' ? null : rest.replace(/\\/g, '/')
}

function parentDirOf(rel: string): string {
  const idx = rel.lastIndexOf('/')
  return idx === -1 ? '' : rel.slice(0, idx)
}

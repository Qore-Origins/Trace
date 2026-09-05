// 计划树枚举缓存：Key=父相对路径，Value=子目录名列表（存储服务写入时失效）
import { parentRel } from './path-safety'

export class TreeCache {
  private map = new Map<string, string[]>()

  get(parentPath: string): string[] | undefined {
    return this.map.get(parentPath)
  }

  set(parentPath: string, names: string[]): void {
    this.map.set(parentPath, names)
  }

  // 路径前缀失效：自身+全部后代（删除/移动场景）；parent 空串前缀匹配所有
  invalidatePrefix(relPath: string): void {
    const prefix = relPath === '' ? '' : relPath + '/'
    for (const key of [...this.map.keys()]) {
      if (key === relPath || key.startsWith(prefix) || relPath === '') this.map.delete(key)
    }
    // 同时失效其父缓存（本层列表变化）
    if (relPath !== '') this.map.delete(parentRel(relPath))
    else this.map.clear()
  }

  clear(): void {
    this.map.clear()
  }
}

// WatchService 测试：自身写入回声抑制（评审 Important-3 补测）
// 验证 markInternalWrite 登记的目录路径能抑制对应的 addDir/目录内文件事件（前缀匹配），
// 且不误伤兄弟/父目录、500ms 后登记过期
import { describe, it, expect, vi, afterEach } from 'vitest'
import { join } from 'node:path'
import { WatchService } from '../src/main/services/watch-service'
import { TreeCache } from '../src/main/services/tree-cache'

afterEach(() => {
  vi.useRealTimers()
})

describe('markInternalWrite + isSuppressed', () => {
  it('登记的目录路径抑制该目录 addDir 与目录内文件事件（前缀匹配，双分隔符）', () => {
    const w = new WatchService(new TreeCache())
    const dir = join('D:\\root', 'Diary', '2026-09-10') // 本平台原生分隔符形态（登记与事件同源：均为原生路径）
    w.markInternalWrite(dir)
    // 目录自身 addDir 事件（首次进日记视图建 Diary/<today>/ 的场景）
    expect(w.isSuppressed(dir)).toBe(true)
    // 目录内文件（原生分隔符）
    expect(w.isSuppressed(join(dir, 'plan.json'))).toBe(true)
    // 正斜杠形态（POSIX 原生；实现按 key+'/' 前缀匹配）
    w.markInternalWrite('D:/root/Diary/2026-09-10')
    expect(w.isSuppressed('D:/root/Diary/2026-09-10/plan.json')).toBe(true)
  })

  it('目录登记不误伤兄弟目录与父目录（前缀边界）', () => {
    const w = new WatchService(new TreeCache())
    w.markInternalWrite('D:\\root\\Diary\\2026-09-10')
    expect(w.isSuppressed('D:\\root\\Diary\\2026-09-11')).toBe(false)
    expect(w.isSuppressed('D:\\root\\Diary\\2026-09-10x')).toBe(false)
    expect(w.isSuppressed('D:\\root\\Diary')).toBe(false)
    expect(w.isSuppressed('D:\\root\\其他计划')).toBe(false)
  })

  it('登记的文件路径只抑制该文件本身（精确匹配，不影响同目录其他文件）', () => {
    const w = new WatchService(new TreeCache())
    w.markInternalWrite('D:\\root\\计划A\\plan.json')
    expect(w.isSuppressed('D:\\root\\计划A\\plan.json')).toBe(true)
    expect(w.isSuppressed('D:\\root\\计划A\\notes.txt')).toBe(false)
    expect(w.isSuppressed('D:\\root\\计划A')).toBe(false)
  })

  it('500ms 后登记过期，事件恢复可见', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'))
    const w = new WatchService(new TreeCache())
    const dir = 'D:\\root\\Diary\\2026-09-10'
    w.markInternalWrite(dir)
    expect(w.isSuppressed(dir)).toBe(true)
    vi.setSystemTime(new Date('2026-09-10T00:00:01.000Z')) // 1s 后
    expect(w.isSuppressed(dir)).toBe(false)
  })
})

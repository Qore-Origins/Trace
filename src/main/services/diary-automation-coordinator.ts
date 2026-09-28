import type { DiaryReconcileResult } from './diary-service'
import type { DiaryAutomationStatus } from '../../shared/event-types'

export interface DiaryAutomationCoordinator {
  activateRoot(root: string): void
  captureRootGuard(root: string): () => boolean
  onFocus(): void
  dispose(): void
}

interface DiaryAutomationDependencies {
  now?: () => Date
  setTimer?: (callback: () => void, delay: number) => unknown
  clearTimer?: (timer: unknown) => void
  reconcile: (root: string, today: string) => Promise<DiaryReconcileResult>
  refresh: (root: string, today: string) => void
  report: (status: DiaryAutomationStatus) => void
}

interface ActiveLibrary {
  root: string
  key: string
  completedDate: string | null
  runningDate: string | null
  retry: boolean
  pending: boolean
}

function localDate(value: Date): string {
  const pad = (part: number, width = 2): string => String(part).padStart(width, '0')
  return `${pad(value.getFullYear(), 4)}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

export function createDiaryAutomationCoordinator(dependencies: DiaryAutomationDependencies): DiaryAutomationCoordinator {
  const now = dependencies.now ?? (() => new Date())
  const setTimer = dependencies.setTimer ?? ((callback, delay) => setTimeout(callback, delay))
  const clearTimer = dependencies.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  const flights = new Map<string, Promise<void>>()
  let active: ActiveLibrary | null = null
  let disposed = false
  let startupTimer: unknown = null
  let midnightTimer: unknown = null

  const isActive = (library: ActiveLibrary): boolean => !disposed && active === library
  const cancelTimers = (): void => {
    if (startupTimer !== null) clearTimer(startupTimer)
    if (midnightTimer !== null) clearTimer(midnightTimer)
    startupTimer = null
    midnightTimer = null
  }

  const run = (library: ActiveLibrary): void => {
    if (!isActive(library)) return
    const today = localDate(now())
    if (library.runningDate === today) return
    if (flights.has(library.key)) {
      library.pending = true // 同一根的新 activation 或跨日触发必须等旧 flight 完成。
      return
    }
    if (!library.retry && library.completedDate === today) return
    library.pending = false
    library.runningDate = today
    dependencies.report({ state: 'running', retryable: false })

    const operation = Promise.resolve()
      .then(() => isActive(library) ? dependencies.reconcile(library.root, today) : null)
      .then((result) => {
        if (!isActive(library) || !result) return
        if (result.createdDates.length > 0) dependencies.refresh(library.root, today)
        if (!isActive(library)) return
        library.completedDate = today
        library.retry = false
        dependencies.report({ state: 'complete', retryable: false })
      })
      .catch(() => {
        if (!isActive(library)) return
        library.retry = true
        // 部分日页可能已经写入，但 checkpoint 未推进；重试也可能零创建。
        // 先刷新仍活跃的库，再公布可重试错误，绝不携带原始异常。
        try {
          dependencies.refresh(library.root, today)
        } finally {
          if (isActive(library)) dependencies.report({ state: 'error', retryable: true })
        }
      })
      .finally(() => {
        flights.delete(library.key)
        library.runningDate = null
        const current = active
        if (current && current.key === library.key && current.pending) run(current)
      })
    flights.set(library.key, operation)
  }

  const scheduleMidnight = (): void => {
    if (midnightTimer !== null) clearTimer(midnightTimer)
    midnightTimer = null
    if (disposed || !active) return
    const current = now()
    const midnight = new Date(current)
    midnight.setHours(24, 0, 0, 0) // 本地下一天零点；DST 日可为 23/25 小时。
    midnightTimer = setTimer(() => {
      midnightTimer = null
      if (active) run(active)
      scheduleMidnight()
    }, midnight.getTime() - current.getTime())
  }

  return {
    activateRoot(root) {
      if (disposed) return
      cancelTimers()
      const library: ActiveLibrary = {
        root,
        key: process.platform === 'win32' ? root.toLowerCase() : root,
        completedDate: null,
        runningDate: null,
        retry: false,
        pending: false
      }
      active = library // 对象身份即 activation generation，A→B→A 也不会接收旧完成。
      dependencies.report({ state: 'running', retryable: false })
      startupTimer = setTimer(() => {
        startupTimer = null
        run(library)
      }, 0)
      scheduleMidnight()
    },
    onFocus() {
      if (disposed || !active) return
      // 恢复窗口时重新取本地日期与零点，覆盖休眠/时区变更；当天完成后不重复写。
      scheduleMidnight()
      run(active)
    },
    captureRootGuard(root) {
      const library = active
      if (!library || library.root !== root) return () => false
      return () => isActive(library)
    },
    dispose() {
      if (disposed) return
      disposed = true
      cancelTimers()
      active = null
    }
  }
}

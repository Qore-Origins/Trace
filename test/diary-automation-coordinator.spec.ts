import { afterEach, describe, expect, it } from 'vitest'
import { createDiaryAutomationCoordinator } from '../src/main/services/diary-automation-coordinator'
import { createStartupCoordinator } from '../src/main/services/startup-coordinator'
import type { DiaryReconcileResult } from '../src/main/services/diary-service'
import type { DiaryAutomationStatus } from '../src/shared/event-types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const result = (today: string, createdDates = [today]): DiaryReconcileResult => ({
  today, createdDates, lastReconciledDate: today
})

function harness(operation: (root: string, date: string) => Promise<DiaryReconcileResult> = async (_root, date) => result(date)) {
  let now = new Date(2026, 8, 28, 14)
  let timerId = 0
  const timers = new Map<number, { callback: () => void; at: number }>()
  const attempts: Array<{ root: string; date: string }> = []
  const notifications: Array<{ kind: 'refresh'; root: string; today: string } | { kind: 'status'; status: DiaryAutomationStatus }> = []
  const coordinator = createDiaryAutomationCoordinator({
    now: () => new Date(now),
    setTimer(callback, delay) {
      const id = ++timerId
      timers.set(id, { callback, at: now.getTime() + delay })
      return id
    },
    clearTimer: (id) => { if (typeof id === 'number') timers.delete(id) },
    reconcile: (root, date) => {
      attempts.push({ root, date })
      return operation(root, date)
    },
    refresh: (root, today) => notifications.push({ kind: 'refresh', root, today }),
    report: (status) => notifications.push({ kind: 'status', status })
  })
  return {
    coordinator, attempts, notifications, timers,
    setNow(value: Date) { now = value },
    async runTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at > now.getTime()) continue
        timers.delete(id)
        timer.callback()
      }
      for (let i = 0; i < 12; i++) await Promise.resolve()
    },
    nextDelay: () => Math.min(...[...timers.values()].map((timer) => timer.at - now.getTime()))
  }
}

const previousTimezone = process.env.TZ
afterEach(() => {
  if (previousTimezone === undefined) delete process.env.TZ
  else process.env.TZ = previousTimezone
})

describe('diary automation coordinator', () => {
  it('starts after window display and root activation without delaying bootstrap', async () => {
    const activation = deferred<boolean>()
    const reconciliation = deferred<DiaryReconcileResult>()
    const h = harness(() => reconciliation.promise)
    const startup = createStartupCoordinator({
      activateConfiguredRoot: async () => {
        await activation.promise
        h.coordinator.activateRoot('library-a')
        return true
      }
    })
    expect(h.attempts).toEqual([])
    startup.onWindowShown()
    activation.resolve(true)
    await startup.waitForBootstrap()
    expect(h.attempts).toEqual([])
    await h.runTimers()
    expect(h.attempts).toEqual([{ root: 'library-a', date: '2026-09-28' }])
    expect(startup.getRootActivationStatus()).toBe('active')
    reconciliation.resolve(result('2026-09-28'))
    await h.runTimers()
    h.coordinator.dispose()
  })

  it('replaces a queued root before any diary write starts', async () => {
    const h = harness()
    h.coordinator.activateRoot('library-a')
    h.coordinator.activateRoot('library-b')
    await h.runTimers()
    expect(h.attempts).toEqual([{ root: 'library-b', date: '2026-09-28' }])
    expect(h.notifications.filter((event) => event.kind === 'refresh')).toEqual([
      { kind: 'refresh', root: 'library-b', today: '2026-09-28' }
    ])
    h.coordinator.dispose()
  })

  it('invalidates a foreground root guard even when switching away and back to the same path', () => {
    const h = harness()
    h.coordinator.onFocus()
    expect(h.notifications).toEqual([])
    expect(h.coordinator.captureRootGuard('library-a')()).toBe(false)
    h.coordinator.activateRoot('library-a')
    expect(h.coordinator.captureRootGuard).toBeTypeOf('function')
    const guard = h.coordinator.captureRootGuard('library-a')
    expect(guard()).toBe(true)
    expect(h.coordinator.captureRootGuard('library-b')()).toBe(false)
    h.coordinator.activateRoot('library-b')
    h.coordinator.activateRoot('library-a')
    expect(guard()).toBe(false)
    const newGuard = h.coordinator.captureRootGuard('library-a')
    expect(newGuard()).toBe(true)
    h.coordinator.dispose()
    expect(newGuard()).toBe(false)
  })

  it('cancels a scheduled reconcile microtask when the root is replaced', async () => {
    const h = harness()
    h.coordinator.activateRoot('library-a')
    h.coordinator.onFocus()
    h.coordinator.activateRoot('library-b')
    await h.runTimers()
    expect(h.attempts).toEqual([{ root: 'library-b', date: '2026-09-28' }])
    h.coordinator.dispose()
  })

  it.each(['resolve', 'reject'] as const)('suppresses an old root %s after switching libraries', async (outcome) => {
    const old = deferred<DiaryReconcileResult>()
    const h = harness((root, date) => root === 'library-a' ? old.promise : Promise.resolve(result(date)))
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    expect(h.attempts).toEqual([{ root: 'library-a', date: '2026-09-28' }])
    h.coordinator.activateRoot('library-b')
    await h.runTimers()
    const visible = [...h.notifications]
    if (outcome === 'resolve') old.resolve(result('2026-09-28'))
    else old.reject(new Error('private diary text in C:\\private-library'))
    await h.runTimers()
    expect(h.notifications).toEqual(visible)
    h.coordinator.dispose()
  })

  it('refreshes partially written pages before a sanitized retryable failure', async () => {
    let attempt = 0
    const h = harness(async (_root, date) => {
      if (++attempt === 1) throw new Error('checkpoint denied: C:\\private-library\\secret diary')
      return result(date, []) // Pages already written by the failed run need no new writes.
    })
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    expect(h.notifications.slice(-2)).toEqual([
      { kind: 'refresh', root: 'library-a', today: '2026-09-28' },
      { kind: 'status', status: { state: 'error', retryable: true } }
    ])
    expect(JSON.stringify(h.notifications)).not.toContain('private-library')
    h.coordinator.onFocus()
    await h.runTimers()
    expect(h.attempts).toHaveLength(2)
    expect(h.notifications.at(-1)).toEqual({ kind: 'status', status: { state: 'complete', retryable: false } })
    expect(h.notifications.filter((event) => event.kind === 'refresh')).toHaveLength(1)
    h.coordinator.onFocus()
    await h.runTimers()
    expect(h.attempts).toHaveLength(2)
    h.coordinator.dispose()
  })

  it('keeps focus triggers single flight while reconciliation is pending', async () => {
    const pending = deferred<DiaryReconcileResult>()
    const h = harness(() => pending.promise)
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    h.coordinator.onFocus()
    h.coordinator.onFocus()
    await h.runTimers()
    expect(h.attempts).toHaveLength(1)
    pending.resolve(result('2026-09-28', []))
    await h.runTimers()
    expect(h.notifications.filter((event) => event.kind === 'refresh')).toEqual([])
    h.coordinator.dispose()
  })

  it('waits for the same root flight when switching away and back', async () => {
    const old = deferred<DiaryReconcileResult>()
    let aAttempts = 0
    const h = harness((root, date) => root === 'library-a' && ++aAttempts === 1 ? old.promise : Promise.resolve(result(date)))
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    h.coordinator.activateRoot('library-b')
    await h.runTimers()
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    expect(h.attempts.filter(({ root }) => root === 'library-a')).toHaveLength(1)
    old.resolve(result('2026-09-28'))
    await h.runTimers()
    expect(h.attempts.filter(({ root }) => root === 'library-a')).toHaveLength(2)
    expect(h.notifications.filter((event) => event.kind === 'refresh' && event.root === 'library-a')).toHaveLength(1)
    h.coordinator.dispose()
  })

  it('reconciles the new local date at midnight and after a suspended clock jumps', async () => {
    const h = harness()
    h.setNow(new Date(2026, 8, 28, 23, 59))
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    expect(h.nextDelay()).toBe(60_000)
    h.setNow(new Date(2026, 8, 29))
    await h.runTimers()
    expect(h.attempts.map(({ date }) => date)).toEqual(['2026-09-28', '2026-09-29'])
    h.setNow(new Date(2026, 9, 2, 10))
    h.coordinator.onFocus()
    await h.runTimers()
    expect(h.attempts.at(-1)?.date).toBe('2026-10-02')
    h.coordinator.dispose()
  })

  it('queues the new day once if midnight arrives during a slow run', async () => {
    const pending = deferred<DiaryReconcileResult>()
    const h = harness((_root, date) => date === '2026-09-28' ? pending.promise : Promise.resolve(result(date)))
    h.setNow(new Date(2026, 8, 28, 23, 59))
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    h.setNow(new Date(2026, 8, 29))
    await h.runTimers()
    expect(h.attempts).toHaveLength(1)
    pending.resolve(result('2026-09-28'))
    await h.runTimers()
    expect(h.attempts.map(({ date }) => date)).toEqual(['2026-09-28', '2026-09-29'])
    h.coordinator.dispose()
  })

  it.each([
    ['2026-03-08T00:00:00-05:00', 23],
    ['2026-11-01T00:00:00-04:00', 25]
  ])('schedules calendar midnight through DST at %s', async (date, hours) => {
    process.env.TZ = 'America/New_York'
    const h = harness()
    h.setNow(new Date(date))
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    expect(h.nextDelay()).toBe(hours * 60 * 60 * 1000)
    h.coordinator.dispose()
  })

  it('disposes timers and ignores late results and future activations', async () => {
    const pending = deferred<DiaryReconcileResult>()
    const h = harness(() => pending.promise)
    h.coordinator.activateRoot('library-a')
    await h.runTimers()
    h.coordinator.dispose()
    const before = [...h.notifications]
    pending.resolve(result('2026-09-28'))
    h.coordinator.onFocus()
    h.coordinator.activateRoot('library-b')
    await h.runTimers()
    expect(h.timers.size).toBe(0)
    expect(h.attempts).toHaveLength(1)
    expect(h.notifications).toEqual(before)
  })
})

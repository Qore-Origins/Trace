import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const {
  RendererExceptionMonitor,
  enableRuntimeExceptionEvents,
  waitForWebSocketClose,
  closeRendererClientAfterTargetCloses
} = require('../scripts/renderer-exception-monitor.cjs') as {
  RendererExceptionMonitor: new () => {
    recordProtocolEvent(clientName: string, message: { method?: string }): boolean
    snapshot(): { total: number; byClient: Record<string, number>; lastClientName: string | null }
  }
  enableRuntimeExceptionEvents: (client: { send: (method: string) => Promise<unknown> }) => Promise<void>
  waitForWebSocketClose: (
    webSocket: {
      addEventListener: (type: string, listener: () => void, options?: { once?: boolean }) => void
      removeEventListener: (type: string, listener: () => void) => void
    },
    isClosed: () => boolean,
    timeoutMs: number
  ) => Promise<void>
  closeRendererClientAfterTargetCloses: (
    client: { close: () => void },
    waitForTargetClose: () => Promise<void>,
    waitForClientClose: () => Promise<void>
  ) => Promise<void>
}

const TEST_WEBSOCKET_CLOSE_TIMEOUT_MS = 25

class FakeWebSocket {
  readyState = 'OPEN'
  listeners = new Map<string, Map<() => void, boolean>>()

  addEventListener(type: string, listener: () => void, options?: { once?: boolean }) {
    const listeners = this.listeners.get(type) ?? new Map()
    listeners.set(listener, options?.once === true)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string) {
    for (const [listener, once] of [...(this.listeners.get(type) ?? [])]) {
      if (once) this.removeEventListener(type, listener)
      listener()
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0
  }
}

describe('renderer exception monitor', () => {
  it('enables Runtime exception events for every attached renderer target', async () => {
    const mainSend = vi.fn().mockResolvedValue({})
    const approvalSend = vi.fn().mockResolvedValue({})
    const confirmationSend = vi.fn().mockResolvedValue({})

    await Promise.all([
      enableRuntimeExceptionEvents({ send: mainSend }),
      enableRuntimeExceptionEvents({ send: approvalSend }),
      enableRuntimeExceptionEvents({ send: confirmationSend })
    ])

    expect(mainSend).toHaveBeenCalledExactlyOnceWith('Runtime.enable')
    expect(approvalSend).toHaveBeenCalledExactlyOnceWith('Runtime.enable')
    expect(confirmationSend).toHaveBeenCalledExactlyOnceWith('Runtime.enable')
  })

  it('aggregates uncaught exceptions from main, approval, and confirmation renderers', () => {
    const monitor = new RendererExceptionMonitor()

    expect(monitor.recordProtocolEvent('main-renderer', { method: 'Runtime.exceptionThrown' })).toBe(true)
    expect(monitor.recordProtocolEvent('external-approval', { method: 'Runtime.exceptionThrown' })).toBe(true)
    expect(monitor.recordProtocolEvent('main-operation-confirmation', { method: 'Runtime.exceptionThrown' })).toBe(true)

    expect(monitor.snapshot()).toEqual({
      total: 3,
      byClient: {
        'external-approval': 1,
        'main-operation-confirmation': 1,
        'main-renderer': 1
      },
      lastClientName: 'main-operation-confirmation'
    })
  })

  it('ignores unrelated protocol events and keeps previously captured snapshots stable', () => {
    const monitor = new RendererExceptionMonitor()
    const baseline = monitor.snapshot()

    expect(monitor.recordProtocolEvent('external-approval', { method: 'Log.entryAdded' })).toBe(false)
    expect(monitor.snapshot()).toEqual(baseline)

    monitor.recordProtocolEvent('external-approval', { method: 'Runtime.exceptionThrown' })

    expect(baseline).toEqual({ total: 0, byClient: {}, lastClientName: null })
    expect(monitor.snapshot().total).toBe(1)
  })

  it('resolves immediately when the close event was already observed', async () => {
    const webSocket = new FakeWebSocket()
    let closeEventObserved = false
    webSocket.addEventListener('close', () => { closeEventObserved = true }, { once: true })
    webSocket.dispatch('close')

    await expect(waitForWebSocketClose(webSocket, () => closeEventObserved, TEST_WEBSOCKET_CLOSE_TIMEOUT_MS)).resolves.toBeUndefined()
    expect(webSocket.listenerCount('close')).toBe(0)
  })

  it('waits for the close event even if readyState is already CLOSED', async () => {
    const webSocket = new FakeWebSocket()
    let closeEventObserved = false
    webSocket.readyState = 'CLOSED'

    const closeWait = waitForWebSocketClose(webSocket, () => closeEventObserved, TEST_WEBSOCKET_CLOSE_TIMEOUT_MS)

    expect(webSocket.listenerCount('close')).toBe(1)
    closeEventObserved = true
    webSocket.dispatch('close')

    await expect(closeWait).resolves.toBeUndefined()
    expect(webSocket.listenerCount('close')).toBe(0)
  })

  it('resolves and removes its listener when the websocket close event arrives', async () => {
    const webSocket = new FakeWebSocket()
    const closeWait = waitForWebSocketClose(webSocket, () => false, TEST_WEBSOCKET_CLOSE_TIMEOUT_MS)

    webSocket.dispatch('close')

    await expect(closeWait).resolves.toBeUndefined()
    expect(webSocket.listenerCount('close')).toBe(0)
  })

  it('rejects on timeout and removes its close listener', async () => {
    vi.useFakeTimers()
    try {
      const webSocket = new FakeWebSocket()
      const closeWait = waitForWebSocketClose(webSocket, () => false, TEST_WEBSOCKET_CLOSE_TIMEOUT_MS)
      const rejection = expect(closeWait).rejects.toThrow(`CDP websocket close timed out after ${TEST_WEBSOCKET_CLOSE_TIMEOUT_MS}ms`)

      await vi.advanceTimersByTimeAsync(TEST_WEBSOCKET_CLOSE_TIMEOUT_MS)
      await rejection

      expect(webSocket.listenerCount('close')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the CDP client open until the renderer target and its websocket close', async () => {
    const sequence: string[] = []

    await closeRendererClientAfterTargetCloses(
      { close: () => sequence.push('connection-closed') },
      async () => { sequence.push('target-closed') },
      async () => { sequence.push('websocket-closed') }
    )

    expect(sequence).toEqual(['target-closed', 'websocket-closed', 'connection-closed'])
  })

  it('closes the CDP client if waiting for its renderer target to close fails', async () => {
    const close = vi.fn()
    const failure = new Error('target close timed out')

    await expect(closeRendererClientAfterTargetCloses(
      { close },
      async () => { throw failure },
      async () => undefined
    )).rejects.toBe(failure)

    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the CDP client if waiting for its websocket to close fails', async () => {
    const close = vi.fn()
    const failure = new Error('websocket close timed out')

    await expect(closeRendererClientAfterTargetCloses(
      { close },
      async () => undefined,
      async () => { throw failure }
    )).rejects.toBe(failure)

    expect(close).toHaveBeenCalledOnce()
  })
})

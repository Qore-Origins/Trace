import { describe, expect, it, vi } from 'vitest'
import { createApplicationQuitCoordinator, createStartupCoordinator } from '../src/main/services/startup-coordinator'
import type { PlantUmlStatusDto } from '../src/shared/plantuml-types'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('startup coordinator', () => {
  it('queues root activation and background work until after the window is shown', async () => {
    const rootActivation = deferred<void>()
    const order: string[] = []
    const activateConfiguredRoot = vi.fn(() => {
      order.push('root activation')
      return rootActivation.promise
    })
    const coordinator = createStartupCoordinator({ activateConfiguredRoot })
    const bootstrap = coordinator.waitForBootstrap().then(() => order.push('bootstrap ready'))
    const backgroundService = coordinator.runAfterRootActivation(async () => {
      order.push('PlantUML configure')
      return 'configured'
    })

    expect(activateConfiguredRoot).not.toHaveBeenCalled()
    expect(order).toEqual([])

    order.push('window.show')
    coordinator.onWindowShown()
    coordinator.onWindowShown()
    expect(order).toEqual(['window.show', 'root activation'])
    expect(activateConfiguredRoot).toHaveBeenCalledTimes(1)

    rootActivation.resolve()
    await bootstrap
    expect(order).toEqual(['window.show', 'root activation', 'bootstrap ready', 'PlantUML configure'])
    await expect(backgroundService).resolves.toBe('configured')
  })

  it('releases the bootstrap gate after root activation fails and reports the failure once', async () => {
    const rootActivation = deferred<void>()
    const activationError = new Error('root initialization failed')
    const onRootActivationError = vi.fn()
    const coordinator = createStartupCoordinator({
      activateConfiguredRoot: () => rootActivation.promise,
      onRootActivationError
    })
    const bootstrap = coordinator.waitForBootstrap()
    const backgroundService = coordinator.runAfterRootActivation(() => 'still schedulable')

    coordinator.onWindowShown()
    rootActivation.reject(activationError)

    await expect(bootstrap).resolves.toBeUndefined()
    await expect(backgroundService).resolves.toBe('still schedulable')
    expect(onRootActivationError).toHaveBeenCalledTimes(1)
    expect(onRootActivationError).toHaveBeenCalledWith(activationError)
  })

  it('waits for the visible-window signal before running a root activation that resolves immediately', async () => {
    const order: string[] = []
    const coordinator = createStartupCoordinator({
      activateConfiguredRoot: () => {
        order.push('root activation')
      }
    })
    const ready = coordinator.waitForBootstrap().then(() => order.push('bootstrap ready'))

    expect(order).toEqual([])
    order.push('window.show')
    coordinator.onWindowShown()
    await ready

    expect(order).toEqual(['window.show', 'root activation', 'bootstrap ready'])
  })

  it('fails closed on an unconfirmed service shutdown and retries without disposing IPC twice', async () => {
    const failedShutdown = deferred<PlantUmlStatusDto>()
    const successfulShutdown = deferred<PlantUmlStatusDto>()
    const shutdown = vi.fn()
      .mockReturnValueOnce(failedShutdown.promise)
      .mockReturnValueOnce(successfulShutdown.promise)
    const disposeIpc = vi.fn()
    const quit = vi.fn()
    const onShutdownFailure = vi.fn()
    const coordinator = createApplicationQuitCoordinator({ shutdown, disposeIpc, quit, onShutdownFailure })
    const firstEvent = { preventDefault: vi.fn() }
    const repeatedEvent = { preventDefault: vi.fn() }

    coordinator.beforeQuit(firstEvent)
    coordinator.beforeQuit(repeatedEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(repeatedEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(disposeIpc).not.toHaveBeenCalled()

    failedShutdown.resolve({ state: 'error', port: 18080, errorCode: 'stop_timeout' })
    await vi.waitFor(() => expect(onShutdownFailure).toHaveBeenCalledTimes(1))
    expect(quit).not.toHaveBeenCalled()

    const retryEvent = { preventDefault: vi.fn() }
    coordinator.beforeQuit(retryEvent)
    expect(retryEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(shutdown).toHaveBeenCalledTimes(2)
    expect(disposeIpc).not.toHaveBeenCalled()

    successfulShutdown.resolve({ state: 'stopped', port: 18080, errorCode: null })
    await vi.waitFor(() => expect(quit).toHaveBeenCalledTimes(1))
    expect(disposeIpc).toHaveBeenCalledTimes(1)

    const reentrantEvent = { preventDefault: vi.fn() }
    coordinator.beforeQuit(reentrantEvent)
    expect(reentrantEvent.preventDefault).not.toHaveBeenCalled()
    expect(shutdown).toHaveBeenCalledTimes(2)
  })
})

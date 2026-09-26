import type { PlantUmlStatusDto } from '../../shared/plantuml-types'

export type RootActivationStatus = 'pending' | 'active' | 'inactive' | 'failed'

export interface StartupCoordinator {
  onWindowShown(): void
  waitForRootActivation(): Promise<void>
  waitForBootstrap(): Promise<void>
  getRootActivationStatus(): RootActivationStatus
  runAfterRootActivation<T>(operation: () => T | Promise<T>): Promise<T>
  markRootActivated(): void
}

export interface StartupCoordinatorDependencies {
  activateConfiguredRoot: () => unknown | Promise<unknown>
  onRootActivationError?: (error: unknown) => void
}

export function createStartupCoordinator(dependencies: StartupCoordinatorDependencies): StartupCoordinator {
  let releaseRootActivation!: () => void
  let rootActivationStatus: RootActivationStatus = 'pending'
  const rootActivationComplete = new Promise<void>((resolveActivation) => {
    releaseRootActivation = resolveActivation
  })
  let rootActivationStarted = false

  const onWindowShown = (): void => {
    if (rootActivationStarted) return
    rootActivationStarted = true

    let activation: Promise<unknown>
    try {
      activation = Promise.resolve(dependencies.activateConfiguredRoot())
    } catch (error) {
      activation = Promise.reject(error)
    }

    void activation.then(
      (result) => {
        rootActivationStatus = result === false ? 'inactive' : 'active'
        releaseRootActivation()
      },
      (error: unknown) => {
        rootActivationStatus = 'failed'
        try {
          dependencies.onRootActivationError?.(error)
        } catch {
          // Startup reporting must not hold the bootstrap gate closed.
        }
        releaseRootActivation()
      }
    )
  }

  return {
    onWindowShown,
    waitForRootActivation: () => rootActivationComplete,
    waitForBootstrap: () => rootActivationComplete,
    getRootActivationStatus: () => rootActivationStatus,
    async runAfterRootActivation<T>(operation: () => T | Promise<T>): Promise<T> {
      await rootActivationComplete
      return operation()
    },
    markRootActivated() {
      rootActivationStatus = 'active'
    }
  }
}

export interface BeforeQuitEventLike {
  preventDefault(): void
}

export interface ApplicationQuitCoordinatorDependencies {
  shutdown: () => Promise<PlantUmlStatusDto>
  disposeIpc: () => void
  quit: () => void
  onShutdownFailure: (status: PlantUmlStatusDto | null) => void
}

export interface ApplicationQuitCoordinator {
  beforeQuit(event: BeforeQuitEventLike): void
}

export function createApplicationQuitCoordinator(
  dependencies: ApplicationQuitCoordinatorDependencies
): ApplicationQuitCoordinator {
  let quitAllowed = false
  let ipcDisposed = false
  let shutdownInFlight: Promise<void> | null = null

  const reportFailure = (status: PlantUmlStatusDto | null): void => {
    try {
      dependencies.onShutdownFailure(status)
    } catch {
      // Reporting failure must not accidentally release the app quit gate.
    }
  }

  const beforeQuit = (event: BeforeQuitEventLike): void => {
    if (quitAllowed) return
    event.preventDefault()
    if (shutdownInFlight) return

    let shutdown: Promise<PlantUmlStatusDto>
    try {
      shutdown = dependencies.shutdown()
    } catch {
      reportFailure(null)
      return
    }

    const operation = Promise.resolve(shutdown)
      .then((status) => {
        if (status.state !== 'stopped') {
          reportFailure(status)
          return
        }
        quitAllowed = true
        if (!ipcDisposed) {
          ipcDisposed = true
          try {
            dependencies.disposeIpc()
          } catch {
            reportFailure(null)
          }
        }
        dependencies.quit()
      })
      .catch(() => reportFailure(null))
      .finally(() => {
        if (shutdownInFlight === operation) shutdownInFlight = null
      })
    shutdownInFlight = operation
  }

  return { beforeQuit }
}

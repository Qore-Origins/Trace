import { request as httpRequest } from 'node:http'
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import PlantUmlEncoder from 'plantuml-encoder'
import {
  DEFAULT_PLANTUML_PORT,
  validatePlantumlPort,
  type PlantUmlServiceState,
  type PlantUmlStatusDto
} from '../../shared/plantuml-types'

export interface PlantumlChildProcess {
  readonly killed: boolean
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
}

export interface PlantumlSpawnOptions {
  shell: false
  windowsHide: true
  stdio: 'ignore'
}

export type PlantumlSpawn = (
  executablePath: string,
  args: string[],
  options: PlantumlSpawnOptions
) => PlantumlChildProcess

export interface PlantumlRuntimeResources {
  runtimeDirectory: string
  plantumlJar: string
}

export interface PlantumlServiceDependencies {
  spawn: PlantumlSpawn
  checkPlantumlEndpoint: (port: number, signal: AbortSignal) => Promise<boolean>
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  resolveResources: () => PlantumlRuntimeResources
}

export interface PlantumlService {
  configure(configuration: { enabled: boolean; port: number }): Promise<PlantUmlStatusDto>
  start(port?: number): Promise<PlantUmlStatusDto>
  stop(): Promise<PlantUmlStatusDto>
  retry(): Promise<PlantUmlStatusDto>
  getStatus(): PlantUmlStatusDto
  onStatus(listener: (status: PlantUmlStatusDto) => void): () => void
}

type PlantumlErrorCode = 'runtime_missing' | 'plantuml_jar_missing' | 'spawn_failed' | 'startup_timeout' | 'process_exit' | 'stop_timeout'

const STARTUP_TIMEOUT_MS = 12_000
const CHILD_STOP_TIMEOUT_MS = 2_000
const HEALTH_CHECK_INTERVAL_MS = 250
const HTTP_PROBE_TIMEOUT_MS = 1_000
const MAX_HEALTH_RESPONSE_BYTES = 256 * 1024
const MAX_HEALTH_CHECK_ATTEMPTS = Math.floor((STARTUP_TIMEOUT_MS + HEALTH_CHECK_INTERVAL_MS) / (HTTP_PROBE_TIMEOUT_MS + HEALTH_CHECK_INTERVAL_MS))
const HEALTH_CHECK_UML = '@startuml\nAlice -> Bob: TRACE_PLANTUML_HEALTHCHECK\n@enduml'
const HEALTH_CHECK_MARKER = 'TRACE_PLANTUML_HEALTHCHECK'

async function hasFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

function systemDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolveDelay, rejectDelay) => {
    if (signal.aborted) {
      rejectDelay(new Error('aborted'))
      return
    }

    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolveDelay()
    }, milliseconds)
    const abort = (): void => {
      clearTimeout(timeout)
      rejectDelay(new Error('aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

function isChildAlive(child: PlantumlChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null
}

function isSvgHealthResponse(statusCode: number | undefined, contentType: string | undefined, body: string): boolean {
  if (statusCode !== 200 || !contentType?.toLowerCase().startsWith('image/svg+xml')) return false
  if (!/<svg(?:\s|>)/i.test(body)) return false
  return body.includes(HEALTH_CHECK_MARKER)
}

export function checkPlantumlEndpoint(port: number, signal: AbortSignal): Promise<boolean> {
  const encodedSource = PlantUmlEncoder.encode(HEALTH_CHECK_UML)
  const endpointPath = `/plantuml/svg/${encodedSource}`

  return new Promise((resolveProbe) => {
    if (signal.aborted) {
      resolveProbe(false)
      return
    }

    let body = ''
    let bytesReceived = 0
    let settled = false
    let request: ReturnType<typeof httpRequest>
    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      resolveProbe(result)
    }
    const abort = (): void => {
      request.destroy()
      finish(false)
    }

    request = httpRequest({
      hostname: '127.0.0.1',
      port,
      path: endpointPath,
      method: 'GET',
      timeout: HTTP_PROBE_TIMEOUT_MS,
      headers: { accept: 'image/svg+xml' }
    }, (response) => {
      response.setEncoding('utf8')
      response.on('data', (chunk: string) => {
        bytesReceived += Buffer.byteLength(chunk)
        if (bytesReceived > MAX_HEALTH_RESPONSE_BYTES) {
          request.destroy()
          finish(false)
          return
        }
        body += chunk
      })
      response.on('end', () => finish(isSvgHealthResponse(
        response.statusCode,
        response.headers['content-type'],
        body
      )))
    })
    request.on('error', () => finish(false))
    request.on('timeout', () => request.destroy())
    signal.addEventListener('abort', abort, { once: true })
    request.end()
  })
}

export function createPlantumlService(dependencies: PlantumlServiceDependencies): PlantumlService {
  const delay = dependencies.delay ?? systemDelay
  let status: PlantUmlStatusDto = { state: 'stopped', port: DEFAULT_PLANTUML_PORT, errorCode: null }
  let activeChild: PlantumlChildProcess | null = null
  let startupAbortController: AbortController | null = null
  let desiredConfiguration: { enabled: boolean; port: number } = { enabled: false, port: DEFAULT_PLANTUML_PORT }
  let pendingConfigurationKey: string | null = null
  let pendingTransition: Promise<PlantUmlStatusDto> | null = null
  let transitionQueue: Promise<void> = Promise.resolve()
  let transitionVersion = 0
  const stopRequestedChildren = new WeakSet<PlantumlChildProcess>()
  const listeners = new Set<(status: PlantUmlStatusDto) => void>()

  const publish = (errorCode: PlantumlErrorCode | null, state: PlantUmlServiceState, port: number | null): PlantUmlStatusDto => {
    status = { state, port, errorCode }
    for (const listener of listeners) {
      try {
        listener({ ...status })
      } catch {
        // A status observer cannot interfere with the child process lifecycle.
      }
    }
    return { ...status }
  }

  const stopActiveChild = async (): Promise<boolean> => {
    startupAbortController?.abort()
    startupAbortController = null
    const child = activeChild
    if (!child) return true
    if (!isChildAlive(child)) {
      activeChild = null
      return true
    }
    const exited = new Promise<void>((resolveExit) => {
      child.once('exit', () => resolveExit())
    })
    const timeoutController = new AbortController()
    const stopTimeout = delay(CHILD_STOP_TIMEOUT_MS, timeoutController.signal).catch(() => undefined)
    if (!stopRequestedChildren.has(child)) {
      stopRequestedChildren.add(child)
      try {
        child.kill()
      } catch {
        // Child details are intentionally not logged.
      }
    }
    await Promise.race([exited, stopTimeout])
    timeoutController.abort()
    if (!isChildAlive(child)) {
      if (activeChild === child) activeChild = null
      return true
    }
    return false
  }

  const startChild = async (port: number, version: number): Promise<PlantUmlStatusDto> => {
    let resources: PlantumlRuntimeResources
    try {
      resources = dependencies.resolveResources()
    } catch {
      return publish('runtime_missing', 'error', port)
    }

    const javaExecutable = resolve(resources.runtimeDirectory, 'bin', 'java.exe')
    if (!isAbsolute(resources.runtimeDirectory) || !await hasFile(javaExecutable)) {
      if (version !== transitionVersion) return { ...status }
      return publish('runtime_missing', 'error', port)
    }
    if (!isAbsolute(resources.plantumlJar) || !await hasFile(resources.plantumlJar)) {
      if (version !== transitionVersion) return { ...status }
      return publish('plantuml_jar_missing', 'error', port)
    }
    if (version !== transitionVersion) return { ...status }

    const abortController = new AbortController()
    startupAbortController = abortController
    let child: PlantumlChildProcess
    try {
      child = dependencies.spawn(javaExecutable, [
        '-Djava.awt.headless=true',
        '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
        '-jar',
        resources.plantumlJar,
        '-disablestats',
        `-picoweb:${port}:127.0.0.1`
      ], { shell: false, windowsHide: true, stdio: 'ignore' })
    } catch {
      startupAbortController = null
      return publish('spawn_failed', 'error', port)
    }

    activeChild = child
    let processExited = false
    child.on('error', () => {
      if (activeChild !== child) return
      startupAbortController = null
      publish('spawn_failed', 'error', port)
      abortController.abort()
    })
    child.on('exit', () => {
      if (activeChild !== child) return
      const expectedStop = stopRequestedChildren.has(child)
      if (!expectedStop) processExited = true
      activeChild = null
      startupAbortController = null
      abortController.abort()
      if (!expectedStop) publish('process_exit', 'error', port)
    })

    publish(null, 'starting', port)
    for (let attempt = 0; attempt < MAX_HEALTH_CHECK_ATTEMPTS && !abortController.signal.aborted; attempt += 1) {
      if (activeChild !== child || !isChildAlive(child)) break
      let endpointReady = false
      try {
        endpointReady = await dependencies.checkPlantumlEndpoint(port, abortController.signal)
      } catch {
        endpointReady = false
      }
      if (endpointReady && activeChild === child && isChildAlive(child) && !abortController.signal.aborted) {
        if (startupAbortController === abortController) startupAbortController = null
        return publish(null, 'running', port)
      }
      if (abortController.signal.aborted || activeChild !== child || !isChildAlive(child)) break
      if (attempt + 1 < MAX_HEALTH_CHECK_ATTEMPTS) {
        try {
          await delay(HEALTH_CHECK_INTERVAL_MS, abortController.signal)
        } catch {
          break
        }
      }
    }
    const stopped = await stopActiveChild()
    if (!stopped) return publish('stop_timeout', 'error', status.port ?? port)
    if (processExited || status.state === 'error') return { ...status }
    if (version !== transitionVersion) return { ...status }
    return publish('startup_timeout', 'error', port)
  }

  const enqueueTransition = (
    configuration: { enabled: boolean; port: number },
    force = false
  ): Promise<PlantUmlStatusDto> => {
    const key = `${configuration.enabled}:${configuration.port}`
    if (!force && key === pendingConfigurationKey && pendingTransition) return pendingTransition
    if (!force && key === `${desiredConfiguration.enabled}:${desiredConfiguration.port}` && !pendingTransition) {
      if ((!configuration.enabled && status.state === 'stopped') || (configuration.enabled && (status.state === 'running' || status.state === 'error'))) {
        return Promise.resolve({ ...status })
      }
    }

    desiredConfiguration = { ...configuration }
    const version = ++transitionVersion
    startupAbortController?.abort()
    pendingConfigurationKey = key
    const transition = transitionQueue.then(async () => {
      const stopped = await stopActiveChild()
      if (!stopped) return publish('stop_timeout', 'error', status.port ?? configuration.port)
      if (version !== transitionVersion || desiredConfiguration.enabled !== configuration.enabled || desiredConfiguration.port !== configuration.port) {
        return { ...status }
      }
      if (!configuration.enabled) return publish(null, 'stopped', configuration.port)
      return startChild(configuration.port, version)
    })
    transitionQueue = transition.then(() => undefined, () => undefined)
    pendingTransition = transition
    void transition.finally(() => {
      if (pendingTransition === transition) {
        pendingTransition = null
        pendingConfigurationKey = null
      }
    })
    return transition
  }

  return {
    configure(configuration) {
      validatePlantumlPort(configuration.port)
      return enqueueTransition(configuration)
    },
    start(port = status.port ?? DEFAULT_PLANTUML_PORT) {
      return this.configure({ enabled: true, port })
    },
    stop() {
      return enqueueTransition({ enabled: false, port: status.port ?? DEFAULT_PLANTUML_PORT })
    },
    retry() {
      if (!desiredConfiguration.enabled) return Promise.resolve({ ...status })
      return enqueueTransition({ ...desiredConfiguration }, true)
    },
    getStatus() {
      return { ...status }
    },
    onStatus(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

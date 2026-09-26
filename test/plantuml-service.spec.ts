import { EventEmitter } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLANTUML_PORT } from '../src/shared/plantuml-types'
import { checkPlantumlEndpoint, createPlantumlService, type PlantumlChildProcess, type PlantumlSpawn } from '../src/main/services/plantuml-service'

class TestChildProcess extends EventEmitter implements PlantumlChildProcess {
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  readonly pid = 4512

  kill = vi.fn((_signal?: NodeJS.Signals) => {
    this.killed = true
    this.exitCode = 0
    this.emit('exit', 0, 'SIGTERM')
    return true
  })
}

describe('PlantUML child service', () => {
  let temporaryDirectory: string
  let runtimeDirectory: string
  let javaExecutable: string
  let plantumlJar: string

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'trace-plantuml-service-'))
    runtimeDirectory = join(temporaryDirectory, 'runtime')
    javaExecutable = join(runtimeDirectory, 'bin', 'java.exe')
    plantumlJar = join(runtimeDirectory, 'plantuml-lgpl-1.2026.8.jar')
    await mkdir(join(runtimeDirectory, 'bin'), { recursive: true })
    await writeFile(javaExecutable, 'test runtime')
    await writeFile(plantumlJar, 'test PlantUML jar')
  })

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true })
  })

  function createService(child = new TestChildProcess()) {
    const spawn: PlantumlSpawn = vi.fn(() => child)
    const checkPlantumlEndpoint = vi.fn(async () => true)
    const delay = vi.fn(async () => undefined)
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint,
      delay,
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })

    return { service, spawn, checkPlantumlEndpoint, delay, child }
  }

  it('starts one loopback-only SANDBOX child with the bundled absolute runtime and fixed JAR', async () => {
    const { service, spawn } = createService()

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toEqual({ state: 'running', port: DEFAULT_PLANTUML_PORT, errorCode: null })
    expect(spawn).toHaveBeenCalledWith(
      javaExecutable,
      [
        '-Djava.awt.headless=true',
        '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
        '-jar',
        plantumlJar,
        '-disablestats',
        `-picoweb:${DEFAULT_PLANTUML_PORT}:127.0.0.1`
      ],
      { shell: false, windowsHide: true, stdio: 'ignore' }
    )

    await service.stop()
  })

  it('returns the default stopped state without starting a child', () => {
    const { service, spawn } = createService()

    expect(service.getStatus()).toEqual({ state: 'stopped', port: DEFAULT_PLANTUML_PORT, errorCode: null })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('treats repeated configuration for the running port as idempotent', async () => {
    const { service, spawn } = createService()

    await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })
    const repeatedStatus = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(repeatedStatus.state).toBe('running')
    expect(spawn).toHaveBeenCalledTimes(1)
    await service.stop()
  })

  it('stops the old child before starting a child for a changed port', async () => {
    const firstChild = new TestChildProcess()
    const secondChild = new TestChildProcess()
    const children = [firstChild, secondChild]
    const transitions: string[] = []
    const spawn: PlantumlSpawn = vi.fn((_executable, args) => {
      transitions.push(`spawn:${args.at(-1)}`)
      return children.shift()!
    })
    firstChild.kill.mockImplementation(() => {
      transitions.push('kill:first')
      firstChild.killed = true
      firstChild.exitCode = 0
      firstChild.emit('exit', 0, 'SIGTERM')
      return true
    })
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint: vi.fn(async () => true),
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })

    await service.configure({ enabled: true, port: 18080 })
    await service.configure({ enabled: true, port: 18081 })

    expect(transitions).toEqual([
      'spawn:-picoweb:18080:127.0.0.1',
      'kill:first',
      'spawn:-picoweb:18081:127.0.0.1'
    ])
    expect(service.getStatus()).toMatchObject({ state: 'running', port: 18081 })
    await service.stop()
  })

  it('rejects an invalid port without starting a child', async () => {
    const { service, spawn } = createService()

    expect(() => service.configure({ enabled: true, port: 1023 })).toThrow(RangeError)

    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a missing bundled runtime without spawning', async () => {
    const { service, spawn } = createService()
    await rm(javaExecutable)

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toEqual({ state: 'error', port: DEFAULT_PLANTUML_PORT, errorCode: 'runtime_missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('reports a missing PlantUML JAR without spawning', async () => {
    const { service, spawn } = createService()
    await rm(plantumlJar)

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toEqual({ state: 'error', port: DEFAULT_PLANTUML_PORT, errorCode: 'plantuml_jar_missing' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('sanitizes a synchronous spawn failure', async () => {
    const spawn: PlantumlSpawn = vi.fn(() => {
      throw new Error('PRIVATE_SOURCE_SENTINEL C:\\private\\chart.puml')
    })
    const checkPlantumlEndpoint = vi.fn(async () => true)
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint,
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toMatchObject({ state: 'error', errorCode: 'spawn_failed' })
    expect(JSON.stringify(status)).not.toContain('PRIVATE_SOURCE_SENTINEL')
    expect(checkPlantumlEndpoint).not.toHaveBeenCalled()
  })

  it('sanitizes an asynchronous spawn error and reaps that child', async () => {
    const child = new TestChildProcess()
    const spawn: PlantumlSpawn = vi.fn(() => {
      queueMicrotask(() => child.emit('error', new Error('PRIVATE_SOURCE_SENTINEL')))
      return child
    })
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint: vi.fn(async () => false),
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toMatchObject({ state: 'error', errorCode: 'spawn_failed' })
    expect(JSON.stringify(status)).not.toContain('PRIVATE_SOURCE_SENTINEL')
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('keeps polling until the PlantUML endpoint returns healthy SVG', async () => {
    const { service, checkPlantumlEndpoint, delay } = createService()
    checkPlantumlEndpoint.mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const observedStates: string[] = []
    service.onStatus(({ state }) => observedStates.push(state))

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status.state).toBe('running')
    expect(checkPlantumlEndpoint).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
    expect(observedStates).toEqual(['starting', 'running'])
    await service.stop()
  })

  it('stops the child after bounded health checks time out', async () => {
    const { service, child, checkPlantumlEndpoint } = createService()
    checkPlantumlEndpoint.mockResolvedValue(false)

    const status = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(status).toMatchObject({ state: 'error', errorCode: 'startup_timeout' })
    expect(checkPlantumlEndpoint).toHaveBeenCalled()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('preserves an unexpected child exit when it races with a successful health response', async () => {
    const child = new TestChildProcess()
    let resolveProbe: ((healthy: boolean) => void) | undefined
    const { service, checkPlantumlEndpoint } = createService(child)
    checkPlantumlEndpoint.mockImplementation(() => new Promise((resolveProbeResult) => {
      resolveProbe = resolveProbeResult
    }))

    const starting = service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })
    await vi.waitFor(() => expect(resolveProbe).toBeTypeOf('function'))
    child.exitCode = 1
    child.emit('exit', 1, null)
    resolveProbe?.(true)

    const status = await starting
    expect(status).toMatchObject({ state: 'error', errorCode: 'process_exit' })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('aborts startup on a replaced port without publishing a false timeout', async () => {
    const firstChild = new TestChildProcess()
    const secondChild = new TestChildProcess()
    const children = [firstChild, secondChild]
    const spawn: PlantumlSpawn = vi.fn(() => children.shift()!)
    const checkPlantumlEndpoint = vi.fn((port: number, signal: AbortSignal) => {
      if (port === 18080) {
        return new Promise<boolean>((resolveProbe) => {
          signal.addEventListener('abort', () => resolveProbe(false), { once: true })
        })
      }
      return Promise.resolve(true)
    })
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint,
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })
    const observedStates: Array<{ state: string; port: number | null }> = []
    service.onStatus(({ state, port }) => observedStates.push({ state, port }))

    const oldConfiguration = service.configure({ enabled: true, port: 18080 })
    await vi.waitFor(() => expect(checkPlantumlEndpoint).toHaveBeenCalledTimes(1))
    const newConfiguration = service.configure({ enabled: true, port: 18081 })
    const [supersededStatus, latestStatus] = await Promise.all([oldConfiguration, newConfiguration])

    expect(supersededStatus.state).not.toBe('error')
    expect(latestStatus).toMatchObject({ state: 'running', port: 18081 })
    expect(firstChild.kill).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(observedStates).not.toContainEqual({ state: 'error', port: 18080 })
    await service.stop()
  })

  it('does not expose child error details in status or logs', async () => {
    const { service, child } = createService()
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })
      child.emit('error', new Error('PRIVATE_SOURCE_SENTINEL C:\\private\\chart.puml'))

      expect(service.getStatus().state).toBe('error')
      expect(JSON.stringify(service.getStatus())).not.toContain('PRIVATE_SOURCE_SENTINEL')
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      logSpy.mockRestore()
    }
  })

  it('keeps stop idempotent and kills only the child it spawned', async () => {
    const { service, child } = createService()
    await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    const firstStop = await service.stop()
    const secondStop = await service.stop()

    expect(firstStop.state).toBe('stopped')
    expect(secondStop.state).toBe('stopped')
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('waits for its spawned child to exit before stop resolves', async () => {
    const child = new TestChildProcess()
    const stopTimeoutSignals: AbortSignal[] = []
    child.kill.mockImplementation(() => {
      child.killed = true
      setTimeout(() => {
        child.exitCode = 0
        child.emit('exit', 0, 'SIGTERM')
      }, 10)
      return true
    })
    const service = createPlantumlService({
      spawn: vi.fn(() => child),
      checkPlantumlEndpoint: vi.fn(async () => true),
      delay: vi.fn((milliseconds, signal) => {
        if (milliseconds === 2_000) stopTimeoutSignals.push(signal)
        return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, milliseconds))
      }),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })
    await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })
    const exitListenerBaseline = child.listenerCount('exit')

    await service.stop()

    expect(child.exitCode).toBe(0)
    expect(stopTimeoutSignals[0]?.aborted).toBe(true)
    expect(child.listenerCount('exit')).toBe(exitListenerBaseline)
  })

  it('reissues a forced termination request after stop timeout and waits for the real exit event', async () => {
    const child = new TestChildProcess()
    child.kill.mockImplementation(() => {
      child.killed = true
      return true
    })
    let releaseStopTimeout: (() => void) | undefined
    const stopTimeout = new Promise<void>((resolveTimeout) => {
      releaseStopTimeout = resolveTimeout
    })
    const delay = vi.fn((milliseconds: number) => milliseconds === 2_000 ? stopTimeout : new Promise<void>(() => undefined))
    const service = createPlantumlService({
      spawn: vi.fn(() => child),
      checkPlantumlEndpoint: vi.fn(async () => true),
      delay,
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })
    await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    const shuttingDown = service.shutdown()
    await vi.waitFor(() => expect(releaseStopTimeout).toBeTypeOf('function'))
    releaseStopTimeout?.()
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGKILL'))
    let shutdownSettled = false
    void shuttingDown.then(() => { shutdownSettled = true })
    await Promise.resolve()
    expect(shutdownSettled).toBe(false)

    child.exitCode = 0
    child.emit('exit', 0, 'SIGTERM')
    const status = await shuttingDown

    expect(status).toMatchObject({ state: 'stopped', port: DEFAULT_PLANTUML_PORT, errorCode: null })
  })

  it('keeps stop_timeout when forced termination has no confirmed child exit', async () => {
    const child = new TestChildProcess()
    child.kill.mockImplementation(() => {
      child.killed = true
      return true
    })
    const spawn: PlantumlSpawn = vi.fn(() => child)
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint: vi.fn(async () => true),
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })
    await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    const status = await service.shutdown()

    expect(status).toMatchObject({ state: 'error', errorCode: 'stop_timeout' })
    expect(child.kill).toHaveBeenNthCalledWith(1)
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    expect(child.exitCode).toBeNull()
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('retains child ownership and blocks replacement when stop times out', async () => {
    const firstChild = new TestChildProcess()
    const secondChild = new TestChildProcess()
    firstChild.kill.mockImplementation(() => {
      firstChild.killed = true
      return true
    })
    const children = [firstChild, secondChild]
    const spawn: PlantumlSpawn = vi.fn(() => children.shift()!)
    let releaseFirstStopWait: (() => void) | undefined
    let stopWaitCount = 0
    const stopTimeoutSignals: AbortSignal[] = []
    const delay = vi.fn((milliseconds: number, signal: AbortSignal) => {
      if (milliseconds !== 2_000) return Promise.resolve()
      stopWaitCount += 1
      stopTimeoutSignals.push(signal)
      if (stopWaitCount > 1) return Promise.resolve()
      return new Promise<void>((resolveDelay) => {
        releaseFirstStopWait = resolveDelay
      })
    })
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint: vi.fn(async () => true),
      delay,
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })
    await service.configure({ enabled: true, port: 18080 })
    const exitListenerBaseline = firstChild.listenerCount('exit')

    const changedPort = service.configure({ enabled: true, port: 18081 })
    await vi.waitFor(() => expect(releaseFirstStopWait).toBeTypeOf('function'))
    releaseFirstStopWait?.()
    const firstStopStatus = await changedPort

    expect(firstStopStatus).toMatchObject({ state: 'error', errorCode: 'stop_timeout' })
    expect(stopTimeoutSignals[0].aborted).toBe(true)
    expect(firstChild.listenerCount('exit')).toBe(exitListenerBaseline)
    expect(spawn).toHaveBeenCalledTimes(1)

    const retryWhileOldChildLives = await service.retry()
    expect(retryWhileOldChildLives).toMatchObject({ state: 'error', errorCode: 'stop_timeout' })
    expect(stopTimeoutSignals[1].aborted).toBe(true)
    expect(firstChild.listenerCount('exit')).toBe(exitListenerBaseline)
    expect(spawn).toHaveBeenCalledTimes(1)

    firstChild.exitCode = 0
    firstChild.emit('exit', 0, 'SIGTERM')
    const retryAfterExit = await service.retry()
    expect(retryAfterExit).toMatchObject({ state: 'running', port: 18081 })
    expect(spawn).toHaveBeenCalledTimes(2)
    await service.stop()
  })

  it('does not silently restart a failed same configuration; retry explicitly starts a replacement child', async () => {
    const firstChild = new TestChildProcess()
    const secondChild = new TestChildProcess()
    const children = [firstChild, secondChild]
    const spawn: PlantumlSpawn = vi.fn(() => children.shift()!)
    const checkPlantumlEndpoint = vi.fn(async () => false)
    const service = createPlantumlService({
      spawn,
      checkPlantumlEndpoint,
      delay: vi.fn(async () => undefined),
      resolveResources: () => ({ runtimeDirectory, plantumlJar })
    })

    const firstStatus = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })
    const repeatedStatus = await service.configure({ enabled: true, port: DEFAULT_PLANTUML_PORT })

    expect(firstStatus).toMatchObject({ state: 'error', errorCode: 'startup_timeout' })
    expect(repeatedStatus).toEqual(firstStatus)
    expect(spawn).toHaveBeenCalledTimes(1)

    checkPlantumlEndpoint.mockResolvedValue(true)
    const retry = (service as unknown as { retry: () => Promise<{ state: string }> }).retry
    const retryStatus = await retry.call(service)

    expect(retryStatus.state).toBe('running')
    expect(spawn).toHaveBeenCalledTimes(2)
    await service.stop()
  })

  it('starts with the default port when start is called without an explicit port', async () => {
    const { service, spawn } = createService()
    const start = (service as unknown as { start: () => Promise<{ state: string; port: number | null }> }).start

    const status = await start.call(service)

    expect(status).toMatchObject({ state: 'running', port: DEFAULT_PLANTUML_PORT })
    expect(spawn).toHaveBeenCalledTimes(1)
    await service.stop()
  })
})

describe('PlantUML loopback health probe', () => {
  async function probeServer(contentType: string, body: string): Promise<{ healthy: boolean; path: string | undefined }> {
    let requestPath: string | undefined
    const server = createServer((request, response) => {
      requestPath = request.url
      response.writeHead(200, { 'content-type': contentType })
      response.end(body)
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
    try {
      const healthy = await checkPlantumlEndpoint(address.port, new AbortController().signal)
      return { healthy, path: requestPath }
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
    }
  }

  it('accepts only the expected PlantUML SVG at the fixed loopback endpoint', async () => {
    const result = await probeServer('image/svg+xml', '<svg><text>TRACE_PLANTUML_HEALTHCHECK</text></svg>')

    expect(result.healthy).toBe(true)
    expect(result.path).toMatch(/^\/plantuml\/svg\/[A-Za-z0-9_-]+$/)
  })

  it('rejects an ordinary local HTTP service even when it responds successfully', async () => {
    const result = await probeServer('text/html', '<html>service is ready</html>')

    expect(result.healthy).toBe(false)
    expect(result.path).toMatch(/^\/plantuml\/svg\//)
  })

  it('rejects unrelated SVG content from a service already using the port', async () => {
    const result = await probeServer('image/svg+xml', '<svg><text>another service</text></svg>')

    expect(result.healthy).toBe(false)
  })

  it('rejects redirects without following them to another host', async () => {
    let requestCount = 0
    const server = createServer((_request, response) => {
      requestCount += 1
      response.writeHead(302, { location: 'https://example.invalid/plantuml/svg/health' })
      response.end()
    })
    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not bind a TCP port')
    try {
      const healthy = await checkPlantumlEndpoint(address.port, new AbortController().signal)

      expect(healthy).toBe(false)
      expect(requestCount).toBe(1)
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
    }
  })
})

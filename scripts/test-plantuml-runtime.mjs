import { spawn, execFileSync } from 'node:child_process'
import { access, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createServer, connect } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import PlantumlEncoder from 'plantuml-encoder'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..')
const RUNTIME_DIRECTORY = resolve(REPOSITORY_ROOT, '.build/plantuml-runtime')
const RUNTIME_MANIFEST = resolve(RUNTIME_DIRECTORY, 'manifest.json')
const RUNTIME_LOCK = resolve(REPOSITORY_ROOT, 'scripts/plantuml-runtime.lock.json')
const LOCAL_BINDING = '127.0.0.1'
const MIN_PORT = 1024
const MAX_PORT = 65535
const STARTUP_TIMEOUT_MS = 30_000
const HEALTH_REQUEST_TIMEOUT_MS = 4_000
const STOP_TIMEOUT_MS = 5_000
const HEALTH_MARKER = 'TRACE_PLANTUML_RUNTIME_STEP9_HEALTH'
const URL_CANARY_HEALTH_MARKER = 'TRACE_PLANTUML_URL_CANARY_HEALTH'
const SMOKE_TEMP_DIRECTORY_PREFIX = 'trace-plantuml-runtime-smoke-'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function isWithin(parentPath, candidatePath) {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath))
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new RangeError(`PlantUML smoke port must be between ${MIN_PORT} and ${MAX_PORT}`)
  }
}

export function buildPicoWebLaunchSpec(runtimeDirectory, plantumlJar, port) {
  validatePort(port)
  assert(isAbsolute(runtimeDirectory), 'The PlantUML runtime directory must be absolute')
  assert(isAbsolute(plantumlJar), 'The PlantUML JAR path must be absolute')
  assert(isWithin(runtimeDirectory, plantumlJar), 'The PlantUML JAR must stay inside the bundled runtime')

  return {
    executablePath: resolve(runtimeDirectory, 'bin', 'java.exe'),
    args: [
      '-Djava.awt.headless=true',
      '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
      '-jar',
      plantumlJar,
      '-disablestats',
      `-picoweb:${port}:${LOCAL_BINDING}`
    ]
  }
}

export function getPlantumlRuntimeMetadata(lock) {
  const plantumlJarName = lock?.plantuml?.fileName
  const plantumlVersion = lock?.plantuml?.version
  const plantumlLicensePath = lock?.plantuml?.licenseFile
  const temurinLicensePath = lock?.temurin?.licenseFile
  assert(typeof plantumlJarName === 'string' && plantumlJarName.length > 0, 'Runtime lock is missing the PlantUML filename')
  assert(!plantumlJarName.includes('/') && !plantumlJarName.includes('\\'), 'Runtime lock PlantUML filename must be a basename')
  assert(typeof plantumlVersion === 'string' && plantumlVersion.length > 0, 'Runtime lock is missing the PlantUML version')
  assert(typeof plantumlLicensePath === 'string' && typeof temurinLicensePath === 'string', 'Runtime lock is missing upstream license paths')
  return {
    plantumlJarName,
    plantumlVersion,
    plantumlLicenseName: basename(plantumlLicensePath),
    temurinLicenseName: basename(temurinLicensePath)
  }
}

function readEndpoint(endpoint) {
  const separatorIndex = endpoint.lastIndexOf(':')
  if (separatorIndex < 0) return null
  const port = Number(endpoint.slice(separatorIndex + 1))
  const address = endpoint.slice(0, separatorIndex).replace(/^\[|\]$/g, '')
  return Number.isInteger(port) && address ? { address, port } : null
}

function listTcpListeners(netstatOutput) {
  const listeners = []
  for (const line of netstatOutput.split(/\r?\n/)) {
    const [protocol, localEndpoint, , state, processIdText] = line.trim().split(/\s+/)
    if (protocol?.toUpperCase() !== 'TCP' || state?.toUpperCase() !== 'LISTENING') continue
    const endpoint = readEndpoint(localEndpoint ?? '')
    const processId = Number(processIdText)
    if (endpoint && Number.isInteger(processId)) listeners.push({ ...endpoint, processId })
  }
  return listeners
}

export function assertLoopbackOnlyBindings(netstatOutput, port, processId) {
  const matchingListeners = listTcpListeners(netstatOutput).filter((listener) =>
    listener.port === port && listener.processId === processId
  )
  assert(matchingListeners.length > 0, 'PlantUML did not open a TCP listener for its process and configured port')
  assert(
    matchingListeners.every((listener) => listener.address === LOCAL_BINDING),
    'PlantUML listener escaped the required 127.0.0.1 loopback address'
  )
}

function assertPlantumlIncludeRefusal(response, sentinel, expectedError, includeKind) {
  assert(response.status === 400, `${includeKind} include did not receive the expected HTTP 400 PlantUML refusal (received HTTP ${response.status})`)
  const mediaType = response.contentType.split(';', 1)[0].trim().toLowerCase()
  assert(mediaType === 'image/svg+xml', `${includeKind} include refusal was not returned as PlantUML SVG`)
  assert(
    response.diagramError === expectedError,
    `${includeKind} include did not return the expected PlantUML refusal (${expectedError}; received ${response.diagramError ?? 'no PlantUML error header'})`
  )
  assert(!response.body.includes(sentinel), `${includeKind} include exposed protected content in the SVG response`)
}

export function assertSandboxIncludeBlocked(response, sentinel, expectedError) {
  assertPlantumlIncludeRefusal(response, sentinel, expectedError, 'SANDBOX local file')
}

export function assertSandboxUrlIncludeBlocked(response, sentinel, expectedError, requestCount) {
  assertPlantumlIncludeRefusal(response, sentinel, expectedError, 'SANDBOX URL')
  assert(requestCount === 0, 'SANDBOX URL include reached the local HTTP canary')
}

function isDirectChild(parentPath, candidatePath) {
  const relativePath = relative(resolve(parentPath), resolve(candidatePath))
  return relativePath !== '' && !isAbsolute(relativePath) && !relativePath.includes(sep) && !relativePath.startsWith('..')
}

export async function assertSafeSmokeTempDirectory(directory) {
  const resolvedDirectory = resolve(directory)
  const resolvedTempDirectory = resolve(tmpdir())
  assert(
    isDirectChild(resolvedTempDirectory, resolvedDirectory),
    'Refusing to remove the PlantUML smoke directory outside the system temporary directory'
  )
  assert(
    basename(resolvedDirectory).startsWith(SMOKE_TEMP_DIRECTORY_PREFIX),
    'Refusing to remove a temporary directory not created by this smoke test'
  )

  const directoryInfo = await lstat(resolvedDirectory)
  assert(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), 'Refusing to remove a non-directory or redirected smoke target')
  const [realTempDirectory, realDirectory] = await Promise.all([
    realpath(resolvedTempDirectory),
    realpath(resolvedDirectory)
  ])
  assert(isDirectChild(realTempDirectory, realDirectory), 'Refusing to remove a smoke directory redirected outside the system temporary directory')
  assert(
    relative(resolve(resolvedDirectory), resolve(realDirectory)) === '',
    'Refusing to remove a smoke directory whose resolved target differs from its created path'
  )
  return resolvedDirectory
}

export async function cleanupPlantumlSmokeResources({ stopChild: stopChildResource, closeCanary, cleanupTemporaryFiles }) {
  const cleanupErrors = []
  for (const cleanup of [stopChildResource, closeCanary, cleanupTemporaryFiles]) {
    if (!cleanup) continue
    try {
      await cleanup()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'One or more PlantUML smoke resources could not be cleaned up')
  }
}

async function readPreparedRuntime() {
  const manifestText = await readFile(RUNTIME_MANIFEST, 'utf8').catch(() => null)
  assert(manifestText !== null, 'Prepared PlantUML runtime is missing. Run `npm run plantuml:prepare` first.')
  const manifest = JSON.parse(manifestText)
  const lock = JSON.parse(await readFile(RUNTIME_LOCK, 'utf8'))
  const runtimeMetadata = getPlantumlRuntimeMetadata(lock)
  assert(manifest.schemaVersion === 1, 'Prepared PlantUML runtime manifest is unsupported')
  assert(manifest.target?.platform === 'windows-x64', 'PlantUML runtime smoke requires the prepared Windows x64 runtime')
  assert(manifest.plantuml?.version === runtimeMetadata.plantumlVersion, 'Prepared PlantUML version does not match the runtime lock')
  assert(JSON.stringify(manifest.modules) === JSON.stringify(lock.modules), 'Prepared runtime module list does not match the reviewed lock')
  assert(manifest.output?.files?.some((file) => file.path === 'bin/java.exe'), 'Prepared runtime is missing bundled Java')
  assert(manifest.output.files.some((file) => file.path === runtimeMetadata.plantumlJarName), 'Prepared runtime is missing the PlantUML JAR')
  assert(manifest.output.files.some((file) => file.path === `LICENSES/${runtimeMetadata.plantumlLicenseName}`), 'Prepared runtime is missing the PlantUML license')
  assert(manifest.output.files.some((file) => file.path === `LICENSES/${runtimeMetadata.temurinLicenseName}`), 'Prepared runtime is missing the Temurin notice')

  const javaExecutable = resolve(RUNTIME_DIRECTORY, 'bin', 'java.exe')
  const plantumlJar = resolve(RUNTIME_DIRECTORY, runtimeMetadata.plantumlJarName)
  await Promise.all([access(javaExecutable), access(plantumlJar)])
  return { javaExecutable, plantumlJar }
}

async function getAvailableLoopbackPort() {
  const server = createServer()
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, LOCAL_BINDING, resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Could not reserve a local TCP port')
  const { port } = address
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  validatePort(port)
  return port
}

async function requestSvg(port, source) {
  const encodedSource = PlantumlEncoder.encode(source)
  const url = `http://${LOCAL_BINDING}:${port}/plantuml/svg/${encodedSource}`
  const response = await fetch(url, { signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS), redirect: 'manual' })
  const body = await response.text()
  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    diagramError: response.headers.get('x-plantuml-diagram-error'),
    body
  }
}

function assertHealthySvg(response, marker) {
  assert(response.status === 200, `PlantUML returned HTTP ${response.status} instead of 200`)
  assert(response.contentType.toLowerCase().startsWith('image/svg+xml'), 'PlantUML health response was not SVG')
  assert(/<svg(?:\s|>)/i.test(response.body), 'PlantUML health response did not contain an SVG document')
  assert(response.body.includes(marker), 'PlantUML health SVG omitted the expected local marker')
}

async function waitForHealthySvg(child, port) {
  const source = `@startuml\nAlice -> Bob: ${HEALTH_MARKER}\n@enduml\n`
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  let lastFailure

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Bundled PlantUML process exited before becoming healthy (code ${child.exitCode ?? 'null'})`)
    }
    try {
      const response = await requestSvg(port, source)
      assertHealthySvg(response, HEALTH_MARKER)
      return response
    } catch (error) {
      lastFailure = error
      await delay(200)
    }
  }
  throw new Error(`Bundled PlantUML did not return a local SVG before timeout: ${lastFailure instanceof Error ? lastFailure.message : 'no response'}`)
}

function readNetstat() {
  return execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 })
}

function assertPortHasNoListener(netstatOutput, port) {
  const listeners = listTcpListeners(netstatOutput).filter((listener) => listener.port === port)
  assert(listeners.length === 0, 'PlantUML smoke port still has a TCP listener after child shutdown')
}

async function assertPortRefusesConnection(port) {
  await new Promise((resolveRefused, rejectUnexpected) => {
    const socket = connect({ host: LOCAL_BINDING, port })
    socket.setTimeout(1_000)
    socket.once('connect', () => {
      socket.destroy()
      rejectUnexpected(new Error('PlantUML smoke port accepted a connection after child shutdown'))
    })
    socket.once('error', (error) => {
      socket.destroy()
      if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') resolveRefused()
      else rejectUnexpected(error)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolveRefused()
    })
  })
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (exited) => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      resolveExit(exited)
    }
    const onExit = () => finish(true)
    child.once('exit', onExit)
  })
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill()
  if (await waitForChildExit(child, STOP_TIMEOUT_MS)) return

  if (child.pid) {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      // The final bounded exit check below determines whether shutdown succeeded.
    }
  }
  assert(await waitForChildExit(child, STOP_TIMEOUT_MS), 'Could not confirm bundled PlantUML child shutdown')
}

async function startUrlCanary(sentinel) {
  let requestCount = 0
  const server = createHttpServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(URL_CANARY_HEALTH_MARKER)
      return
    }
    requestCount += 1
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`rectangle "${sentinel}"\n`)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, LOCAL_BINDING, resolveListen)
  })
  const address = server.address()
  assert(address && typeof address !== 'string', 'Could not bind the local URL canary')
  return {
    port: address.port,
    requestCount: () => requestCount,
    close: () => new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()))
  }
}

async function assertUrlCanaryHealthy(canary) {
  const response = await fetch(`http://${LOCAL_BINDING}:${canary.port}/health`, {
    signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    redirect: 'manual'
  })
  const body = await response.text()
  const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase()
  assert(response.status === 200, `PlantUML URL canary health check returned HTTP ${response.status} instead of 200`)
  assert(mediaType === 'text/plain', 'PlantUML URL canary health check returned an unexpected content type')
  assert(body === URL_CANARY_HEALTH_MARKER, 'PlantUML URL canary health check did not return its expected marker')
}

async function runPlantumlRuntimeSmoke() {
  assert(process.platform === 'win32' && process.arch === 'x64', 'PlantUML runtime smoke is supported only on Windows x64')

  const { javaExecutable, plantumlJar } = await readPreparedRuntime()
  const port = await getAvailableLoopbackPort()
  const launchSpec = buildPicoWebLaunchSpec(RUNTIME_DIRECTORY, plantumlJar, port)
  assert(launchSpec.executablePath === javaExecutable, 'Smoke must execute the Java binary bundled with the runtime')
  assert(launchSpec.args.includes('-disablestats'), 'PlantUML statistics must be disabled for runtime smoke')

  let child
  let canary
  let localIncludePath
  const localCanaryDirectory = await mkdtemp(join(tmpdir(), SMOKE_TEMP_DIRECTORY_PREFIX))
  const localFileSentinel = `TRACE_LOCAL_INCLUDE_${process.pid}_${Date.now()}`
  const urlSentinel = `TRACE_URL_INCLUDE_${process.pid}_${Date.now()}`

  try {
    localIncludePath = resolve(localCanaryDirectory, `local-${process.pid}-${Date.now()}.iuml`)
    const localFileContents = `rectangle "${localFileSentinel}"\n`
    await writeFile(localIncludePath, localFileContents, { encoding: 'utf8', flag: 'wx' })
    assert(await readFile(localIncludePath, 'utf8') === localFileContents, 'Local file include fixture was not created with its expected sentinel')

    child = spawn(launchSpec.executablePath, launchSpec.args, {
      cwd: localCanaryDirectory,
      shell: false,
      windowsHide: true,
      stdio: 'ignore'
    })
    assert(child.pid !== undefined, 'Bundled PlantUML child process did not receive a process ID')
    const healthResponse = await waitForHealthySvg(child, port)
    assertLoopbackOnlyBindings(readNetstat(), port, child.pid)

    const localIncludeSource = `@startuml\n!include ${basename(localIncludePath)}\n@enduml\n`
    const localIncludeResponse = await requestSvg(port, localIncludeSource)
    const localIncludeError = `cannot include ${basename(localIncludePath)}`
    assertSandboxIncludeBlocked(localIncludeResponse, localFileSentinel, localIncludeError)

    canary = await startUrlCanary(urlSentinel)
    await assertUrlCanaryHealthy(canary)
    const urlInclude = `http://${LOCAL_BINDING}:${canary.port}/include.iuml`
    const urlIncludeSource = `@startuml\n!include ${urlInclude}\n@enduml\n`
    const urlIncludeResponse = await requestSvg(port, urlIncludeSource)
    await delay(150)
    assertSandboxUrlIncludeBlocked(urlIncludeResponse, urlSentinel, 'Cannot open URL', canary.requestCount())

    child.kill()
    assert(await waitForChildExit(child, STOP_TIMEOUT_MS), 'PlantUML child did not exit after a normal stop request')
    assertPortHasNoListener(readNetstat(), port)
    await assertPortRefusesConnection(port)

    console.log('PlantUML bundled runtime smoke passed: local SVG, loopback-only listener, SANDBOX local/URL includes blocked, statistics disabled, child exit released its port.')
    console.log(`Bundled runtime: ${basename(RUNTIME_DIRECTORY)}; PlantUML: ${healthResponse.status}; port: ${port}`)
  } finally {
    await cleanupPlantumlSmokeResources({
      stopChild: child ? () => stopChild(child) : undefined,
      closeCanary: canary ? () => canary.close() : undefined,
      cleanupTemporaryFiles: async () => {
        const safeDirectory = await assertSafeSmokeTempDirectory(localCanaryDirectory)
        if (localIncludePath) {
          assert(
            isWithin(safeDirectory, localIncludePath) && dirname(resolve(localIncludePath)) === safeDirectory,
            'Refusing to remove a PlantUML smoke fixture outside its owned temporary directory'
          )
        }
        await rm(safeDirectory, { recursive: true, force: true })
      }
    })
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  runPlantumlRuntimeSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

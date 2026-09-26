import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { constants, createReadStream, createWriteStream } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { get as httpsGet } from 'node:https'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { pipeline, Transform } from 'node:stream'

const execFileAsync = promisify(execFile)
const pipelineAsync = promisify(pipeline)
const SCRIPT_PATH = fileURLToPath(import.meta.url)
const REPOSITORY_ROOT = resolve(dirname(SCRIPT_PATH), '..')
const BUILD_ROOT = resolve(REPOSITORY_ROOT, '.build')
const OUTPUT_ROOT = resolve(BUILD_ROOT, 'plantuml-runtime')
const LOCK_PATH = resolve(REPOSITORY_ROOT, 'scripts/plantuml-runtime.lock.json')
const OUTPUT_OWNER_FILE = '.trace-plantuml-runtime-owner.json'
const WORK_OWNER_FILE = '.trace-work-owner.json'
const OWNER_ID = 'trace-plantuml-runtime-prepare-v1'
const RUNTIME_ROOT_NAMES = ['bin', 'conf', 'legal', 'lib', 'release']
const OUTPUT_CONTROL_NAMES = [
  OUTPUT_OWNER_FILE,
  '.manifest.pending',
  'manifest.json',
  '.cache',
  '.staging',
  '.smoke',
  'runtime',
  'LICENSES',
  ...RUNTIME_ROOT_NAMES
]
const ASSET_TIMEOUT_MS = 10 * 60 * 1000
const TOOL_TIMEOUT_MS = 3 * 60 * 1000
const SMOKE_TIMEOUT_MS = 20 * 1000
const PLANTUML_SOURCE = '@startuml\nAlice -> Bob: offline smoke\nBob --> Alice: ready\n@enduml\n'
const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

const EXPECTED_ASSET_URLS = {
  plantuml: 'https://github.com/plantuml/plantuml/releases/download/v1.2026.8/plantuml-lgpl-1.2026.8.jar',
  temurin: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip'
}
const ASSET_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com'])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function normalizePath(value) {
  return resolve(value).replace(/[\\/]+$/, '').toLowerCase()
}

function isWithin(parentPath, candidatePath, allowEqual = false) {
  const parent = resolve(parentPath)
  const candidate = resolve(candidatePath)
  const pathFromParent = relative(parent, candidate)
  if (pathFromParent === '') return allowEqual
  return pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent)
}

function assertPathWithin(parentPath, candidatePath, label, allowEqual = false) {
  assert(isWithin(parentPath, candidatePath, allowEqual), `${label} resolves outside its owned directory: ${candidatePath}`)
}

function assertSafeRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty relative path`)
  assert(!isAbsolute(value), `${label} must not be absolute`)
  assert(!value.includes('\\'), `${label} must use slash-separated path segments`)
  const segments = value.split('/')
  assert(segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'), `${label} contains an unsafe path segment`)
  return segments.join(sep)
}

function assertRecord(value, label) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`)
  return value
}

function validateAsset(asset, expectedUrl, label) {
  assertRecord(asset, label)
  assert(typeof asset.version === 'string' && asset.version.length > 0, `${label}.version is required`)
  assert(typeof asset.fileName === 'string' && asset.fileName.length > 0, `${label}.fileName is required`)
  assert(basename(asset.fileName) === asset.fileName, `${label}.fileName must be a basename`)
  assert(asset.url === expectedUrl, `${label}.url must use the exact official fixed release URL`)
  const parsedUrl = new URL(asset.url)
  assert(parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'github.com', `${label}.url must use official HTTPS GitHub release hosting`)
  assert(decodeURIComponent(parsedUrl.pathname.split('/').at(-1) ?? '') === asset.fileName, `${label}.fileName must match its URL basename`)
  assert(typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(asset.sha256), `${label}.sha256 must be a 64-character SHA-256 hexadecimal digest`)
  assert(Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0, `${label}.sizeBytes must be a positive safe integer`)
}

export function validateRuntimeLock(candidate) {
  const lock = assertRecord(candidate, 'Runtime lock')
  assert(lock.schemaVersion === 1, 'Runtime lock schemaVersion must be 1')
  assertRecord(lock.target, 'Runtime lock target')
  assert(lock.target.os === 'windows' && lock.target.architecture === 'x64' && lock.target.platform === 'windows-x64', 'Runtime lock target must be Windows x64')

  validateAsset(lock.plantuml, EXPECTED_ASSET_URLS.plantuml, 'PlantUML asset')
  assert(lock.plantuml.version === '1.2026.8', 'PlantUML version must remain pinned to 1.2026.8')
  assert(lock.plantuml.distribution === 'LGPL' && lock.plantuml.spdx === 'LGPL-3.0-or-later', 'PlantUML asset must remain the LGPL distribution')
  assert(lock.plantuml.fileName === 'plantuml-lgpl-1.2026.8.jar', 'PlantUML filename must match the pinned LGPL asset')

  validateAsset(lock.temurin, EXPECTED_ASSET_URLS.temurin, 'Temurin asset')
  assert(lock.temurin.version === '21.0.12+8', 'Temurin version must remain pinned to 21.0.12+8')
  assert(lock.temurin.distribution === 'Eclipse Temurin', 'Temurin distribution must remain pinned')
  assert(lock.temurin.fileName === 'OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip', 'Temurin filename must match the pinned Windows x64 JDK asset')

  assert(Array.isArray(lock.modules) && lock.modules.length > 0, 'Runtime lock modules must be a non-empty array')
  assert(lock.modules.every((moduleName) => typeof moduleName === 'string' && /^java\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/.test(moduleName)), 'Runtime lock contains an invalid Java module name')
  assert(new Set(lock.modules).size === lock.modules.length, 'Runtime lock module roots must be unique')

  const licenseFiles = [lock.plantuml.licenseFile, lock.temurin.licenseFile]
  for (const licenseFile of licenseFiles) assertSafeRelativePath(licenseFile, 'License source path')
  assert(new Set(licenseFiles.map((licenseFile) => basename(licenseFile))).size === licenseFiles.length, 'License output filenames must be unique')
  assertRecord(lock.licenseSources, 'Runtime lock licenseSources')

  return lock
}

function isNotFound(error) {
  return error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'
}

async function lstatOrNull(path) {
  try {
    return await fs.lstat(path)
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

async function assertPhysicalDirectory(path, parentPath, label, allowEqual = false) {
  assertPathWithin(parentPath, path, label, allowEqual)
  const information = await fs.lstat(path)
  assert(information.isDirectory() && !information.isSymbolicLink(), `${label} must be a real directory: ${path}`)
  const realPath = await fs.realpath(path)
  assert(normalizePath(realPath) === normalizePath(path), `${label} resolves through a link or alias: ${path}`)
  if (!allowEqual) assertPathWithin(parentPath, realPath, label)
}

async function assertPhysicalFile(path, parentPath, label) {
  assertPathWithin(parentPath, path, label)
  const information = await fs.lstat(path)
  assert(information.isFile() && !information.isSymbolicLink(), `${label} must be a regular file: ${path}`)
  const realPath = await fs.realpath(path)
  assert(normalizePath(realPath) === normalizePath(path), `${label} resolves through a link or alias: ${path}`)
}

async function ensureDirectory(path, parentPath, label, allowEqual = false) {
  assertPathWithin(parentPath, path, label, allowEqual)
  const current = await lstatOrNull(path)
  if (current === null) await fs.mkdir(path)
  await assertPhysicalDirectory(path, parentPath, label, allowEqual)
}

function ownerRecord(directoryPath, parentPath) {
  return {
    owner: OWNER_ID,
    parent: resolve(parentPath),
    directory: resolve(directoryPath),
    schemaVersion: 1
  }
}

function sameOwnerRecord(actual, expected) {
  return actual !== null && typeof actual === 'object' &&
    actual.owner === expected.owner && actual.schemaVersion === expected.schemaVersion &&
    normalizePath(actual.parent) === normalizePath(expected.parent) &&
    normalizePath(actual.directory) === normalizePath(expected.directory)
}

async function ensureOwnedDirectory(directoryPath, parentPath, markerName, allowEqual = false) {
  await ensureDirectory(directoryPath, parentPath, 'Owned PlantUML work directory', allowEqual)
  const markerPath = resolve(directoryPath, markerName)
  assertPathWithin(directoryPath, markerPath, 'Ownership marker')
  const expectedOwner = ownerRecord(directoryPath, parentPath)
  const markerInformation = await lstatOrNull(markerPath)

  if (markerInformation === null) {
    const entries = await fs.readdir(directoryPath)
    assert(entries.length === 0, `Refusing to claim a non-empty unmarked directory: ${directoryPath}`)
    await fs.writeFile(markerPath, `${JSON.stringify(expectedOwner, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return
  }

  await assertPhysicalFile(markerPath, directoryPath, 'Ownership marker')
  let actualOwner
  try {
    actualOwner = JSON.parse(await fs.readFile(markerPath, 'utf8'))
  } catch {
    throw new Error(`Ownership marker is invalid; refusing to clean ${directoryPath}`)
  }
  assert(sameOwnerRecord(actualOwner, expectedOwner), `Ownership marker does not match this script: ${directoryPath}`)
}

async function removeOwnedChild(parentPath, childName) {
  const childPath = resolve(parentPath, childName)
  assertPathWithin(parentPath, childPath, 'Owned cleanup target')
  const information = await lstatOrNull(childPath)
  if (information === null) return
  assert(!information.isSymbolicLink(), `Refusing to remove linked path: ${childPath}`)
  const actualPath = await fs.realpath(childPath)
  assertPathWithin(parentPath, actualPath, 'Owned cleanup target')
  assert(normalizePath(actualPath) === normalizePath(childPath), `Refusing to remove aliased path: ${childPath}`)
  await fs.rm(childPath, { recursive: true, force: false })
}

async function ensureRepositoryBuildDirectories() {
  await ensureDirectory(BUILD_ROOT, REPOSITORY_ROOT, 'Repository .build directory')
  await ensureOwnedDirectory(OUTPUT_ROOT, BUILD_ROOT, OUTPUT_OWNER_FILE)
}

function rootAllowedNames(lock) {
  return new Set([...OUTPUT_CONTROL_NAMES, lock.plantuml.fileName])
}

async function assertKnownOutputRootEntries(lock) {
  const allowedNames = rootAllowedNames(lock)
  const entries = await fs.readdir(OUTPUT_ROOT)
  const unexpectedEntries = entries.filter((name) => !allowedNames.has(name))
  assert(unexpectedEntries.length === 0, `Refusing to touch unknown output entries: ${unexpectedEntries.join(', ')}`)
}

async function assertOwnedChildDirectory(name, allowedNames) {
  const childPath = resolve(OUTPUT_ROOT, name)
  const information = await lstatOrNull(childPath)
  if (information === null) return false
  await ensureOwnedDirectory(childPath, OUTPUT_ROOT, WORK_OWNER_FILE)
  const entries = await fs.readdir(childPath)
  const unexpectedEntries = entries.filter((entry) => entry !== WORK_OWNER_FILE && !allowedNames.has(entry))
  assert(unexpectedEntries.length === 0, `Refusing to clean unknown entries in ${name}: ${unexpectedEntries.join(', ')}`)
  return true
}

function cacheEntries(lock) {
  return new Set([
    lock.plantuml.fileName,
    `${lock.plantuml.fileName}.part`,
    lock.temurin.fileName,
    `${lock.temurin.fileName}.part`,
    'jdk-extracted'
  ])
}

async function cleanOwnedWorkDirectories(lock) {
  const workDirectorySpecs = [
    { name: '.cache', allowed: cacheEntries(lock) },
    { name: '.staging', allowed: new Set(['payload']) },
    { name: '.smoke', allowed: new Set(['tmp']) }
  ]

  for (const spec of workDirectorySpecs) {
    const exists = await assertOwnedChildDirectory(spec.name, spec.allowed)
    if (exists) await removeOwnedChild(OUTPUT_ROOT, spec.name)
  }
}

async function clearKnownProducts(lock) {
  await assertKnownOutputRootEntries(lock)
  const productNames = ['manifest.json', '.manifest.pending', 'runtime', ...RUNTIME_ROOT_NAMES, 'LICENSES', lock.plantuml.fileName]
  for (const name of productNames) await removeOwnedChild(OUTPUT_ROOT, name)
}

async function ensureWorkDirectories(lock) {
  const cachePath = resolve(OUTPUT_ROOT, '.cache')
  const stagingPath = resolve(OUTPUT_ROOT, '.staging')
  await ensureOwnedDirectory(cachePath, OUTPUT_ROOT, WORK_OWNER_FILE)
  await ensureOwnedDirectory(stagingPath, OUTPUT_ROOT, WORK_OWNER_FILE)
  const cacheAllowed = cacheEntries(lock)
  const stagingAllowed = new Set(['payload'])

  for (const [directoryPath, allowed] of [[cachePath, cacheAllowed], [stagingPath, stagingAllowed]]) {
    const entries = await fs.readdir(directoryPath)
    const unexpected = entries.filter((entry) => entry !== WORK_OWNER_FILE && !allowed.has(entry))
    assert(unexpected.length === 0, `Refusing to reuse unknown work files in ${directoryPath}: ${unexpected.join(', ')}`)
    for (const entry of entries) {
      if (entry !== WORK_OWNER_FILE) await removeOwnedChild(directoryPath, entry)
    }
  }

  return { cachePath, stagingPath, payloadPath: resolve(stagingPath, 'payload') }
}

function parseAssetResponse(url, redirectCount = 0) {
  return new Promise((resolveResponse, rejectResponse) => {
    const parsedUrl = new URL(url)
    assert(parsedUrl.protocol === 'https:' && ASSET_HOSTS.has(parsedUrl.hostname), `Unexpected asset host: ${parsedUrl.hostname}`)
    const request = httpsGet(parsedUrl, (response) => {
      const statusCode = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.location
        response.resume()
        if (!location || redirectCount >= 5) {
          rejectResponse(new Error('Asset download exceeded the allowed redirect count'))
          return
        }
        const redirectedUrl = new URL(location, parsedUrl)
        if (redirectedUrl.protocol !== 'https:' || !ASSET_HOSTS.has(redirectedUrl.hostname)) {
          rejectResponse(new Error(`Asset redirect uses an unexpected host: ${redirectedUrl.hostname}`))
          return
        }
        parseAssetResponse(redirectedUrl.href, redirectCount + 1).then(resolveResponse, rejectResponse)
        return
      }
      if (statusCode !== 200) {
        response.resume()
        rejectResponse(new Error(`Asset server returned HTTP ${statusCode}`))
        return
      }
      resolveResponse(response)
    })

    request.setTimeout(ASSET_TIMEOUT_MS, () => request.destroy(new Error('Asset download timed out')))
    request.on('error', rejectResponse)
  })
}

async function downloadVerifiedAsset(asset, destinationPath, cachePath) {
  assertPathWithin(cachePath, destinationPath, 'Asset download path')
  const partialPath = `${destinationPath}.part`
  assertPathWithin(cachePath, partialPath, 'Asset partial path')
  const startedAt = Date.now()
  try {
    console.info(`Downloading locked asset: ${asset.fileName}`)
    const response = await parseAssetResponse(asset.url)
    const hash = createHash('sha256')
    let downloadedBytes = 0
    const meter = new Transform({
      transform(chunk, encoding, callback) {
        downloadedBytes += chunk.length
        if (downloadedBytes > asset.sizeBytes) {
          callback(new Error(`Asset exceeds the locked byte size: ${asset.fileName}`))
          return
        }
        hash.update(chunk)
        callback(null, chunk)
      }
    })
    await pipelineAsync(response, meter, createWriteStream(partialPath, { flags: 'wx' }))
    const actualHash = hash.digest('hex')
    assert(downloadedBytes === asset.sizeBytes, `${asset.fileName} size mismatch: expected ${asset.sizeBytes}, got ${downloadedBytes}`)
    assert(actualHash.toLowerCase() === asset.sha256.toLowerCase(), `${asset.fileName} SHA-256 mismatch`)
    await fs.rename(partialPath, destinationPath)
    console.info(`Verified locked asset: ${asset.fileName} (${downloadedBytes} bytes, SHA-256 ${actualHash})`)
    return { path: destinationPath, sha256: actualHash, sizeBytes: downloadedBytes }
  } catch (error) {
    await removeOwnedChild(cachePath, basename(partialPath)).catch(() => undefined)
    const code = error !== null && typeof error === 'object' && 'code' in error ? ` [${error.code}]` : ''
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${asset.fileName} transfer/verification failed after ${Date.now() - startedAt} ms${code}: ${message}`, { cause: error })
  }
}

async function hashFile(path) {
  const hash = createHash('sha256')
  let sizeBytes = 0
  for await (const chunk of createReadStream(path)) {
    sizeBytes += chunk.length
    hash.update(chunk)
  }
  return { sha256: hash.digest('hex'), sizeBytes }
}

async function runCommand(executable, args, options = {}) {
  assert(isAbsolute(executable), `Executable must be an absolute pinned path: ${executable}`)
  try {
    return await execFileAsync(executable, args, {
      cwd: options.cwd ?? REPOSITORY_ROOT,
      env: options.env ?? process.env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: options.timeout ?? TOOL_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024
    })
  } catch (error) {
    const detail = error !== null && typeof error === 'object'
      ? [error.stdout, error.stderr, error.message].filter((part) => typeof part === 'string' && part.length > 0).join('\n')
      : String(error)
    throw new Error(`Command failed (${basename(executable)}): ${detail}`)
  }
}

function javaToolEnvironment(jdkHome) {
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const blockedJavaEnvironmentKeys = new Set(['JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', '_JAVA_OPTIONS', 'CLASSPATH', 'JAVA_OPTS'])
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !blockedJavaEnvironmentKeys.has(key.toUpperCase())))
  return {
    ...environment,
    JAVA_HOME: jdkHome,
    SystemRoot: windowsRoot,
    WINDIR: windowsRoot,
    PATH: `${join(jdkHome, 'bin')};${join(windowsRoot, 'System32')}`
  }
}

function parseReleaseFile(releaseContents) {
  const values = {}
  for (const line of releaseContents.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)="?([^\"]*)"?$/.exec(line)
    if (match) values[match[1]] = match[2]
  }
  return values
}

async function findPinnedJdk(extractionPath, lock) {
  const entries = await fs.readdir(extractionPath, { withFileTypes: true })
  const candidates = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const candidate = resolve(extractionPath, entry.name)
    const javaPath = resolve(candidate, 'bin/java.exe')
    const jdepsPath = resolve(candidate, 'bin/jdeps.exe')
    const jlinkPath = resolve(candidate, 'bin/jlink.exe')
    const files = await Promise.all([lstatOrNull(javaPath), lstatOrNull(jdepsPath), lstatOrNull(jlinkPath)])
    if (files.every((file) => file?.isFile() === true && !file.isSymbolicLink())) candidates.push(candidate)
  }
  assert(candidates.length === 1, `Expected one extracted Temurin JDK root, found ${candidates.length}`)

  const jdkHome = candidates[0]
  const releasePath = resolve(jdkHome, 'release')
  await assertPhysicalFile(releasePath, extractionPath, 'Temurin release metadata')
  const release = parseReleaseFile(await fs.readFile(releasePath, 'utf8'))
  const expectedMetadata = lock.temurin.releaseMetadata
  assertRecord(expectedMetadata, 'Temurin release metadata lock')
  assert(release.JAVA_VERSION === expectedMetadata.javaVersion, `Extracted JDK Java version mismatch: ${release.JAVA_VERSION}`)
  assert(release.IMPLEMENTOR === expectedMetadata.implementor, `Extracted JDK implementor mismatch: ${release.IMPLEMENTOR}`)
  assert(release.IMPLEMENTOR_VERSION === expectedMetadata.implementorVersion, `Extracted JDK implementor version mismatch: ${release.IMPLEMENTOR_VERSION}`)
  assert(release.OS_ARCH === expectedMetadata.osArchitecture, `Extracted JDK architecture mismatch: ${release.OS_ARCH}`)
  return jdkHome
}

async function extractPinnedJdk(archivePath, extractionPath, cachePath) {
  assertPathWithin(cachePath, archivePath, 'JDK archive path')
  assertPathWithin(cachePath, extractionPath, 'JDK extraction path')
  await ensureDirectory(extractionPath, cachePath, 'JDK extraction directory')
  const powershellScript = [
    "$ErrorActionPreference = 'Stop'",
    'Expand-Archive -LiteralPath $env:TRACE_PLANTUML_ARCHIVE -DestinationPath $env:TRACE_PLANTUML_EXTRACT -Force'
  ].join('\n')
  const encodedScript = Buffer.from(powershellScript, 'utf16le').toString('base64')
  const environment = {
    ...process.env,
    TRACE_PLANTUML_ARCHIVE: archivePath,
    TRACE_PLANTUML_EXTRACT: extractionPath
  }
  const pwshPath = await resolvePwshExecutable()
  await runCommand(pwshPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript], {
    cwd: REPOSITORY_ROOT,
    env: environment,
    timeout: TOOL_TIMEOUT_MS
  })
}

async function resolvePwshExecutable() {
  const pathValue = process.env.PATH ?? process.env.Path ?? ''
  for (const pathEntry of pathValue.split(delimiter).filter(Boolean)) {
    const candidatePath = resolve(pathEntry, 'pwsh.exe')
    const information = await lstatOrNull(candidatePath)
    if (information?.isFile() && !information.isSymbolicLink()) return fs.realpath(candidatePath)
  }
  throw new Error('pwsh.exe is required to extract the pinned Temurin ZIP but was not found on PATH')
}

function parseModuleRoots(jdepsOutput) {
  const outputLines = jdepsOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const moduleLine = outputLines.findLast((line) => /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*(?:,[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*)*$/.test(line))
  assert(moduleLine, `Pinned jdeps did not report a module list: ${jdepsOutput}`)
  return moduleLine.split(',')
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

async function extractAndVerifyLicenses(lock, payloadPath) {
  const licensesPath = resolve(payloadPath, 'LICENSES')
  await ensureDirectory(licensesPath, payloadPath, 'Bundled LICENSES directory')
  const licenses = []

  for (const asset of [lock.plantuml, lock.temurin]) {
    const sourceRelativePath = assertSafeRelativePath(asset.licenseFile, 'License source path')
    const sourcePath = resolve(REPOSITORY_ROOT, sourceRelativePath)
    assertPathWithin(REPOSITORY_ROOT, sourcePath, 'License source file')
    await assertPhysicalFile(sourcePath, REPOSITORY_ROOT, 'Locked upstream license file')
    const fileName = basename(sourcePath)
    const destinationPath = resolve(licensesPath, fileName)
    assertPathWithin(licensesPath, destinationPath, 'License destination')
    await fs.copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    const copiedFile = await hashFile(destinationPath)
    const originalFile = await hashFile(sourcePath)
    assert(copiedFile.sha256 === originalFile.sha256 && copiedFile.sizeBytes === originalFile.sizeBytes, `License copy was modified: ${fileName}`)
    licenses.push({ fileName, sourcePath: sourceRelativePath.replaceAll(sep, '/'), sha256: copiedFile.sha256, sizeBytes: copiedFile.sizeBytes })
  }

  return licenses
}

async function collectOutputFiles(rootPath, expectedTopLevelNames) {
  const entries = await fs.readdir(rootPath)
  const isPublishedOutput = normalizePath(rootPath) === normalizePath(OUTPUT_ROOT)
  const controlNames = new Set([
    OUTPUT_OWNER_FILE,
    'manifest.json',
    '.manifest.pending',
    '.cache',
    '.staging',
    '.smoke'
  ])
  const productEntries = isPublishedOutput ? entries.filter((name) => !controlNames.has(name)) : entries
  const unexpected = productEntries.filter((name) => !expectedTopLevelNames.has(name))
  assert(unexpected.length === 0, `Unexpected runtime output entries: ${unexpected.join(', ')}`)
  const files = []

  async function walk(directory, relativeDirectory) {
    await assertPhysicalDirectory(directory, rootPath, 'Runtime output directory', directory === rootPath)
    const children = await fs.readdir(directory, { withFileTypes: true })
    for (const child of children) {
      const childPath = resolve(directory, child.name)
      assertPathWithin(rootPath, childPath, 'Runtime output path')
      const childRelative = relativeDirectory ? `${relativeDirectory}/${child.name}` : child.name
      const information = await fs.lstat(childPath)
      assert(!information.isSymbolicLink(), `Runtime output must not contain symlinks: ${childRelative}`)
      if (information.isDirectory()) {
        await walk(childPath, childRelative)
        continue
      }
      assert(information.isFile(), `Runtime output contains a non-regular file: ${childRelative}`)
      const digest = await hashFile(childPath)
      files.push({ path: childRelative, sha256: digest.sha256, sizeBytes: digest.sizeBytes })
    }
  }

  for (const name of productEntries) {
    const path = resolve(rootPath, name)
    const information = await fs.lstat(path)
    assert(!information.isSymbolicLink(), `Runtime output must not contain symlinks: ${name}`)
    if (information.isDirectory()) await walk(path, name)
    else {
      assert(information.isFile(), `Runtime output contains a non-regular file: ${name}`)
      const digest = await hashFile(path)
      files.push({ path: name, sha256: digest.sha256, sizeBytes: digest.sizeBytes })
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  return files
}

function createManifest(lock, plantumlAsset, temurinAsset, modules, jdkVersionOutput, licenses, outputFiles) {
  const totalSizeBytes = outputFiles.reduce((total, file) => total + file.sizeBytes, 0)
  const outputByPath = new Map(outputFiles.map((file) => [file.path, file]))
  const runtimeFiles = outputFiles.filter((file) => RUNTIME_ROOT_NAMES.includes(file.path.split('/')[0]))
  const javaExecutable = outputByPath.get('bin/java.exe')
  assert(javaExecutable, 'Generated jlink output is missing bin/java.exe')
  const jarFile = outputByPath.get(lock.plantuml.fileName)
  assert(jarFile, `Generated output is missing ${lock.plantuml.fileName}`)
  assert(jarFile.sha256.toLowerCase() === lock.plantuml.sha256.toLowerCase(), 'Bundled PlantUML JAR hash does not match the pinned asset')

  return {
    schemaVersion: 1,
    owner: OWNER_ID,
    generatedAt: new Date().toISOString(),
    target: lock.target,
    plantuml: {
      version: lock.plantuml.version,
      distribution: lock.plantuml.distribution,
      spdx: lock.plantuml.spdx,
      url: lock.plantuml.url,
      sha256: plantumlAsset.sha256,
      sizeBytes: plantumlAsset.sizeBytes,
      outputFile: { path: lock.plantuml.fileName, sha256: jarFile.sha256, sizeBytes: jarFile.sizeBytes }
    },
    temurin: {
      distribution: lock.temurin.distribution,
      version: lock.temurin.version,
      url: lock.temurin.url,
      sha256: temurinAsset.sha256,
      sizeBytes: temurinAsset.sizeBytes,
      releaseMetadata: lock.temurin.releaseMetadata,
      jdepsRoots: modules
    },
    modules,
    runtime: {
      javaVersionOutput: jdkVersionOutput.trim(),
      javaExecutable: { path: javaExecutable.path, sha256: javaExecutable.sha256, sizeBytes: javaExecutable.sizeBytes },
      fileCount: runtimeFiles.length,
      totalSizeBytes: runtimeFiles.reduce((total, file) => total + file.sizeBytes, 0)
    },
    licenses,
    output: { fileCount: outputFiles.length, totalSizeBytes, files: outputFiles }
  }
}

function manifestMatchesLock(manifest, lock) {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) return false
  if (manifest.schemaVersion !== 1 || manifest.owner !== OWNER_ID) return false
  if (JSON.stringify(manifest.target) !== JSON.stringify(lock.target)) return false
  if (manifest.plantuml?.version !== lock.plantuml.version || manifest.plantuml?.url !== lock.plantuml.url || manifest.plantuml?.sha256?.toLowerCase() !== lock.plantuml.sha256.toLowerCase()) return false
  if (manifest.plantuml?.sizeBytes !== lock.plantuml.sizeBytes || manifest.plantuml?.outputFile?.path !== lock.plantuml.fileName) return false
  if (manifest.temurin?.version !== lock.temurin.version || manifest.temurin?.url !== lock.temurin.url || manifest.temurin?.sha256?.toLowerCase() !== lock.temurin.sha256.toLowerCase()) return false
  if (manifest.temurin?.sizeBytes !== lock.temurin.sizeBytes || !sameStringSet(manifest.modules, lock.modules) || !sameStringSet(manifest.temurin?.jdepsRoots, lock.modules)) return false
  if (!Array.isArray(manifest.output?.files) || manifest.output.files.length === 0) return false
  if (!manifest.output.files.some((file) => file.path === 'bin/java.exe')) return false
  if (!manifest.output.files.some((file) => file.path === lock.plantuml.fileName && file.sha256?.toLowerCase() === lock.plantuml.sha256.toLowerCase())) return false
  if (!Array.isArray(manifest.licenses) || manifest.licenses.length !== 2) return false
  const expectedLicenseNames = new Set([basename(lock.plantuml.licenseFile), basename(lock.temurin.licenseFile)])
  if (!manifest.licenses.every((license) => expectedLicenseNames.has(license.fileName) && typeof license.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(license.sha256))) return false
  for (const license of manifest.licenses) {
    if (!manifest.output.files.some((file) => file.path === `LICENSES/${license.fileName}` && file.sha256?.toLowerCase() === license.sha256.toLowerCase() && file.sizeBytes === license.sizeBytes)) return false
  }
  return true
}

async function compareOutputFiles(outputRoot, manifest, lock) {
  const expectedTopLevelNames = new Set([...RUNTIME_ROOT_NAMES, 'LICENSES', lock.plantuml.fileName])
  let actualFiles
  try {
    actualFiles = await collectOutputFiles(outputRoot, expectedTopLevelNames)
  } catch (error) {
    if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }

  if (!Array.isArray(manifest.output.files) || actualFiles.length !== manifest.output.files.length) return false
  const expectedFiles = [...manifest.output.files].sort((left, right) => left.path.localeCompare(right.path, 'en'))
  for (let index = 0; index < actualFiles.length; index++) {
    const actual = actualFiles[index]
    const expected = expectedFiles[index]
    if (expected === null || typeof expected !== 'object' || actual.path !== expected.path || actual.sha256 !== expected.sha256?.toLowerCase() || actual.sizeBytes !== expected.sizeBytes) return false
  }
  const javaExecutable = actualFiles.find((file) => file.path === 'bin/java.exe')
  const expectedJava = manifest.runtime?.javaExecutable
  if (!javaExecutable || expectedJava?.sha256?.toLowerCase() !== javaExecutable.sha256 || expectedJava?.sizeBytes !== javaExecutable.sizeBytes) return false
  const runtimeFiles = actualFiles.filter((file) => RUNTIME_ROOT_NAMES.includes(file.path.split('/')[0]))
  if (manifest.runtime?.fileCount !== runtimeFiles.length) return false
  if (manifest.runtime?.totalSizeBytes !== runtimeFiles.reduce((total, file) => total + file.sizeBytes, 0)) return false
  if (manifest.output?.fileCount !== actualFiles.length || manifest.output?.totalSizeBytes !== actualFiles.reduce((total, file) => total + file.sizeBytes, 0)) return false
  return true
}

async function readAndVerifyRuntimeManifest(outputRoot, lock) {
  const manifestPath = resolve(outputRoot, 'manifest.json')
  assertPathWithin(outputRoot, manifestPath, 'Runtime manifest path')
  const information = await lstatOrNull(manifestPath)
  if (information === null) return null
  await assertPhysicalFile(manifestPath, outputRoot, 'Runtime manifest')
  let manifest
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  } catch {
    return null
  }
  if (!manifestMatchesLock(manifest, lock)) return null
  if (!await compareOutputFiles(outputRoot, manifest, lock)) return null
  return manifest
}

async function readLock() {
  const lockBytes = await fs.readFile(LOCK_PATH, 'utf8')
  const lock = JSON.parse(lockBytes)
  return validateRuntimeLock(lock)
}

async function prepareRuntime() {
  assert(process.platform === 'win32', 'PlantUML runtime preparation is supported only on Windows x64')
  const lock = await readLock()
  await ensureRepositoryBuildDirectories()
  await assertKnownOutputRootEntries(lock)

  const previousManifest = await readAndVerifyRuntimeManifest(OUTPUT_ROOT, lock)
  if (previousManifest !== null) {
    await cleanOwnedWorkDirectories(lock)
    console.info(`PlantUML runtime already verified; reusing ${OUTPUT_ROOT}`)
    return previousManifest
  }

  await clearKnownProducts(lock)

  let workDirectories
  try {
    workDirectories = await ensureWorkDirectories(lock)
    const { cachePath, stagingPath, payloadPath } = workDirectories
    await ensureDirectory(payloadPath, stagingPath, 'Runtime staging payload')

    const plantumlCachePath = resolve(cachePath, lock.plantuml.fileName)
    const temurinCachePath = resolve(cachePath, lock.temurin.fileName)
    const plantumlAsset = await downloadVerifiedAsset(lock.plantuml, plantumlCachePath, cachePath)
    const temurinAsset = await downloadVerifiedAsset(lock.temurin, temurinCachePath, cachePath)

    const extractionPath = resolve(cachePath, 'jdk-extracted')
    await extractPinnedJdk(temurinCachePath, extractionPath, cachePath)
    const jdkHome = await findPinnedJdk(extractionPath, lock)
    const jdkEnvironment = javaToolEnvironment(jdkHome)
    const jdepsPath = resolve(jdkHome, 'bin/jdeps.exe')
    const jlinkPath = resolve(jdkHome, 'bin/jlink.exe')
    const jdkJavaPath = resolve(jdkHome, 'bin/java.exe')

    const versionResult = await runCommand(jdkJavaPath, ['-version'], { cwd: cachePath, env: jdkEnvironment })
    const jdkVersionOutput = `${versionResult.stdout}\n${versionResult.stderr}`.trim()
    assert(jdkVersionOutput.includes(lock.temurin.releaseMetadata.javaVersion), 'Pinned JDK java -version output does not match the lock')
    const jdepsVersion = await runCommand(jdepsPath, ['--version'], { cwd: cachePath, env: jdkEnvironment })
    assert(`${jdepsVersion.stdout}\n${jdepsVersion.stderr}`.includes(lock.temurin.releaseMetadata.javaVersion), 'Pinned jdeps version does not match the lock')

    const jdepsResult = await runCommand(jdepsPath, [
      '--multi-release', '21',
      '--ignore-missing-deps',
      '--print-module-deps',
      plantumlCachePath
    ], { cwd: cachePath, env: jdkEnvironment })
    const discoveredModules = parseModuleRoots(jdepsResult.stdout)
    assert(sameStringSet(discoveredModules, lock.modules), `Pinned jdeps roots (${discoveredModules.join(',')}) do not match lock roots (${lock.modules.join(',')})`)

    const runtimePath = resolve(payloadPath, 'runtime')
    assertPathWithin(payloadPath, runtimePath, 'jlink output path')
    const jlinkArguments = [
      '--module-path', resolve(jdkHome, 'jmods'),
      '--add-modules', lock.modules.join(','),
      '--strip-debug',
      '--no-header-files',
      '--no-man-pages',
      '--compress=2',
      '--output', runtimePath
    ]
    await runCommand(jlinkPath, jlinkArguments, { cwd: cachePath, env: jdkEnvironment })

    const runtimeJavaPath = resolve(runtimePath, 'bin/java.exe')
    await assertPhysicalFile(runtimeJavaPath, runtimePath, 'jlink runtime java.exe')
    await assertPhysicalFile(resolve(runtimePath, 'lib/modules'), runtimePath, 'jlink runtime module image')
    const runtimeVersion = await runCommand(runtimeJavaPath, ['-version'], {
      cwd: cachePath,
      env: javaToolEnvironment(runtimePath)
    })
    const runtimeVersionOutput = `${runtimeVersion.stdout}\n${runtimeVersion.stderr}`.trim()
    assert(runtimeVersionOutput.includes(lock.temurin.releaseMetadata.javaVersion), 'Generated jlink runtime has an unexpected Java version')

    const runtimeEntries = await fs.readdir(runtimePath)
    assert(runtimeEntries.length === RUNTIME_ROOT_NAMES.length && RUNTIME_ROOT_NAMES.every((name) => runtimeEntries.includes(name)), `Unexpected jlink image root entries: ${runtimeEntries.join(', ')}`)
    for (const name of RUNTIME_ROOT_NAMES) {
      const sourcePath = resolve(runtimePath, name)
      const destinationPath = resolve(payloadPath, name)
      assertPathWithin(runtimePath, sourcePath, 'jlink runtime entry')
      assertPathWithin(payloadPath, destinationPath, 'runtime root entry')
      await fs.rename(sourcePath, destinationPath)
    }
    await removeOwnedChild(payloadPath, 'runtime')
    const directRuntimeJavaPath = resolve(payloadPath, 'bin/java.exe')
    await assertPhysicalFile(directRuntimeJavaPath, payloadPath, 'Published-layout jlink java.exe')

    const jarOutputPath = resolve(payloadPath, lock.plantuml.fileName)
    assertPathWithin(payloadPath, jarOutputPath, 'PlantUML JAR output')
    await fs.copyFile(plantumlCachePath, jarOutputPath, constants.COPYFILE_EXCL)
    const copiedPlantuml = await hashFile(jarOutputPath)
    assert(copiedPlantuml.sha256.toLowerCase() === lock.plantuml.sha256.toLowerCase() && copiedPlantuml.sizeBytes === lock.plantuml.sizeBytes, 'Copied PlantUML JAR does not match its pinned original asset')

    const licenses = await extractAndVerifyLicenses(lock, payloadPath)
    const outputFiles = await collectOutputFiles(payloadPath, new Set([...RUNTIME_ROOT_NAMES, 'LICENSES', lock.plantuml.fileName]))
    const manifest = createManifest(lock, plantumlAsset, temurinAsset, lock.modules, runtimeVersionOutput, licenses, outputFiles)
    assert(manifestMatchesLock(manifest, lock), 'Generated runtime manifest does not match its lock')
    assert(await compareOutputFiles(payloadPath, manifest, lock), 'Generated runtime output failed its manifest hash verification')

    const cacheAllowed = cacheEntries(lock)
    const cacheEntriesNow = await fs.readdir(cachePath)
    const unexpectedCacheEntries = cacheEntriesNow.filter((entry) => entry !== WORK_OWNER_FILE && !cacheAllowed.has(entry))
    assert(unexpectedCacheEntries.length === 0, `Unexpected task cache entries: ${unexpectedCacheEntries.join(', ')}`)
    for (const entry of cacheEntriesNow) {
      if (entry !== WORK_OWNER_FILE) await removeOwnedChild(cachePath, entry)
    }
    await removeOwnedChild(OUTPUT_ROOT, '.cache')

    await assertKnownOutputRootEntries(lock)
    for (const name of [...RUNTIME_ROOT_NAMES, lock.plantuml.fileName, 'LICENSES']) {
      if (await lstatOrNull(resolve(payloadPath, name)) === null) continue
      const sourcePath = resolve(payloadPath, name)
      const destinationPath = resolve(OUTPUT_ROOT, name)
      assertPathWithin(stagingPath, sourcePath, 'Staged runtime product')
      assertPathWithin(OUTPUT_ROOT, destinationPath, 'Published runtime product')
      await fs.rename(sourcePath, destinationPath)
    }
    await removeOwnedChild(OUTPUT_ROOT, '.staging')

    const pendingManifestPath = resolve(OUTPUT_ROOT, '.manifest.pending')
    const manifestPath = resolve(OUTPUT_ROOT, 'manifest.json')
    assertPathWithin(OUTPUT_ROOT, pendingManifestPath, 'Pending manifest path')
    assertPathWithin(OUTPUT_ROOT, manifestPath, 'Published manifest path')
    await fs.writeFile(pendingManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await assertPhysicalFile(pendingManifestPath, OUTPUT_ROOT, 'Pending runtime manifest')
    await fs.rename(pendingManifestPath, manifestPath)

    const verifiedManifest = await readAndVerifyRuntimeManifest(OUTPUT_ROOT, lock)
    assert(verifiedManifest !== null, 'Published PlantUML runtime failed final manifest verification')
    console.info(`PlantUML runtime prepared at ${OUTPUT_ROOT}`)
    console.info(`Pinned roots: ${lock.modules.join(', ')}`)
    console.info(`Output bytes: ${verifiedManifest.output.totalSizeBytes}`)
    return verifiedManifest
  } catch (error) {
    const cleanupErrors = []
    try {
      await removeOwnedChild(OUTPUT_ROOT, 'manifest.json')
      await removeOwnedChild(OUTPUT_ROOT, '.manifest.pending')
      await clearKnownProducts(lock)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
    try {
      await cleanOwnedWorkDirectories(lock)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
    const originalMessage = error instanceof Error ? error.message : String(error)
    const cleanupMessage = cleanupErrors.length > 0 ? `; cleanup also failed: ${cleanupErrors.join('; ')}` : ''
    throw new Error(`PlantUML runtime preparation failed: ${originalMessage}${cleanupMessage}`)
  }
}

function encodePlantuml(source) {
  const compressed = deflateRawSync(Buffer.from(source, 'utf8'))
  let encoded = ''
  for (let index = 0; index < compressed.length; index += 3) {
    const first = compressed[index]
    const second = index + 1 < compressed.length ? compressed[index + 1] : 0
    const third = index + 2 < compressed.length ? compressed[index + 2] : 0
    encoded += PLANTUML_ALPHABET[first >> 2]
    encoded += PLANTUML_ALPHABET[((first & 0x03) << 4) | (second >> 4)]
    encoded += PLANTUML_ALPHABET[((second & 0x0f) << 2) | (third >> 6)]
    encoded += PLANTUML_ALPHABET[third & 0x3f]
  }
  return encoded
}

function allocateLoopbackPort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => rejectPort(new Error('Unable to allocate a loopback TCP port')))
        return
      }
      server.close((error) => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

function requestSvg(port, encodedDiagram) {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: `/plantuml/svg/${encodedDiagram}`,
      timeout: 3000
    }, (response) => {
      const chunks = []
      let sizeBytes = 0
      response.on('data', (chunk) => {
        sizeBytes += chunk.length
        if (sizeBytes > 5 * 1024 * 1024) {
          response.destroy(new Error('PlantUML smoke SVG exceeded the response limit'))
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => resolveResponse({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    request.once('timeout', () => request.destroy(new Error('PlantUML smoke HTTP request timed out')))
    request.once('error', rejectResponse)
    request.end()
  })
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    delay(timeoutMs).then(() => { throw new Error('PlantUML smoke service did not exit after stop') })
  ])
}

async function waitForPortRelease(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const server = createServer()
    const available = await new Promise((resolveAvailability, rejectAvailability) => {
      server.once('error', (error) => {
        if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE') resolveAvailability(false)
        else rejectAvailability(error)
      })
      server.listen(port, '127.0.0.1', () => server.close((error) => error ? rejectAvailability(error) : resolveAvailability(true)))
    })
    if (available) return
    await delay(150)
  }
  throw new Error(`PlantUML loopback port ${port} was not released after stopping its process`)
}

export function assertLoopbackListeningBindings(netstatOutput, port, processId) {
  const listeningAddresses = []
  for (const line of netstatOutput.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/)
    if (columns[0]?.toUpperCase() !== 'TCP' || columns[3]?.toUpperCase() !== 'LISTENING' || columns[4] !== String(processId)) continue

    const localEndpoint = columns[1]
    let address
    let portText
    if (localEndpoint.startsWith('[')) {
      const closingBracket = localEndpoint.indexOf(']')
      if (closingBracket < 0 || localEndpoint[closingBracket + 1] !== ':') continue
      address = localEndpoint.slice(1, closingBracket)
      portText = localEndpoint.slice(closingBracket + 2)
    } else {
      const separator = localEndpoint.lastIndexOf(':')
      if (separator < 1) continue
      address = localEndpoint.slice(0, separator)
      portText = localEndpoint.slice(separator + 1)
    }
    if (!/^\d+$/.test(portText) || Number(portText) !== port) continue
    listeningAddresses.push(address)
  }

  assert(listeningAddresses.includes('127.0.0.1'), `PlantUML did not listen on the expected 127.0.0.1:${port} endpoint`)
  assert(listeningAddresses.every((address) => address === '127.0.0.1'), `PlantUML smoke service must listen only on 127.0.0.1:${port}`)
}

async function assertListeningOnLoopback(port, processId, systemRoot) {
  const netstatPath = resolve(systemRoot, 'System32/netstat.exe')
  const result = await runCommand(netstatPath, ['-ano', '-n', '-p', 'tcp'], { cwd: REPOSITORY_ROOT, env: process.env })
  assertLoopbackListeningBindings(result.stdout, port, processId)
}

async function smokeRuntime() {
  assert(process.platform === 'win32', 'PlantUML runtime smoke is supported only on Windows x64')
  const lock = await readLock()
  await ensureRepositoryBuildDirectories()
  await assertKnownOutputRootEntries(lock)
  const manifest = await readAndVerifyRuntimeManifest(OUTPUT_ROOT, lock)
  assert(manifest !== null, 'Prepared runtime is missing or failed manifest/hash verification; run npm run plantuml:prepare first')

  const smokeDirectory = resolve(OUTPUT_ROOT, '.smoke')
  await ensureOwnedDirectory(smokeDirectory, OUTPUT_ROOT, WORK_OWNER_FILE)
  const smokeEntries = await fs.readdir(smokeDirectory)
  const unexpectedSmokeEntries = smokeEntries.filter((entry) => entry !== WORK_OWNER_FILE && entry !== 'tmp')
  assert(unexpectedSmokeEntries.length === 0, `Unexpected smoke work entries: ${unexpectedSmokeEntries.join(', ')}`)
  for (const entry of smokeEntries) if (entry !== WORK_OWNER_FILE) await removeOwnedChild(smokeDirectory, entry)
  const temporaryPath = resolve(smokeDirectory, 'tmp')
  await ensureDirectory(temporaryPath, smokeDirectory, 'PlantUML smoke temporary directory')

  const runtimeJava = resolve(OUTPUT_ROOT, 'bin/java.exe')
  const plantumlJar = resolve(OUTPUT_ROOT, lock.plantuml.fileName)
  await assertPhysicalFile(runtimeJava, OUTPUT_ROOT, 'Prepared jlink Java executable')
  await assertPhysicalFile(plantumlJar, OUTPUT_ROOT, 'Prepared PlantUML JAR')
  const port = await allocateLoopbackPort()
  const windowsRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows'
  const environment = {
    SystemRoot: windowsRoot,
    WINDIR: windowsRoot,
    PATH: resolve(windowsRoot, 'System32'),
    TEMP: temporaryPath,
    TMP: temporaryPath,
    PLANTUML_SECURITY_PROFILE: 'SANDBOX'
  }
  const argumentsList = [
    '-Djava.awt.headless=true',
    `-Djava.io.tmpdir=${temporaryPath}`,
    `-Duser.home=${temporaryPath}`,
    '-jar', plantumlJar,
    '-disablestats',
    `-picoweb:${port}:127.0.0.1`
  ]
  const child = spawn(runtimeJava, argumentsList, {
    cwd: OUTPUT_ROOT,
    env: environment,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore']
  })

  try {
    assert(isAbsolute(runtimeJava), 'PlantUML smoke must launch the generated runtime using an absolute executable path')
    const startedAt = Date.now()
    let renderedSvg = null
    let lastError = null
    while (Date.now() - startedAt < SMOKE_TIMEOUT_MS) {
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`Prepared PlantUML service exited before becoming ready (exit=${child.exitCode}, signal=${child.signalCode})`)
      }
      try {
        const response = await requestSvg(port, encodePlantuml(PLANTUML_SOURCE))
        if (response.statusCode === 200 && /<svg\b/i.test(response.body) && /<\/svg\s*>/i.test(response.body)) {
          renderedSvg = response.body
          break
        }
        lastError = new Error(`PlantUML returned HTTP ${response.statusCode} or invalid SVG`)
      } catch (error) {
        lastError = error
      }
      await delay(250)
    }
    assert(renderedSvg !== null, `Prepared PlantUML runtime failed the offline SVG smoke: ${lastError instanceof Error ? lastError.message : 'service readiness timed out'}`)
    assert(renderedSvg.includes('offline smoke'), 'Generated SVG did not contain the smoke diagram label')
    await assertListeningOnLoopback(port, child.pid, windowsRoot)
    console.info(`Offline PlantUML smoke passed: HTTP 200, valid SVG (${Buffer.byteLength(renderedSvg)} bytes), 127.0.0.1:${port}, PID ${child.pid}`)
    console.info(`Java executable: ${runtimeJava}`)
    console.info('Environment: PLANTUML_SECURITY_PROFILE=SANDBOX, -disablestats, PATH limited to Windows System32')
  } finally {
    if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) child.kill()
    if (child.pid !== undefined) {
      await waitForProcessExit(child, 5000)
      await waitForPortRelease(port, 5000)
    }
    await removeOwnedChild(OUTPUT_ROOT, '.smoke')
  }
}

async function main() {
  const argumentsList = process.argv.slice(2)
  if (argumentsList.length === 0) {
    await prepareRuntime()
    return
  }
  if (argumentsList.length === 1 && argumentsList[0] === '--smoke') {
    await smokeRuntime()
    return
  }
  throw new Error('Usage: node scripts/prepare-plantuml-runtime.mjs [--smoke]')
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : ''
if (normalizePath(invokedScript) === normalizePath(SCRIPT_PATH)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

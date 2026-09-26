import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

type PlantumlSmokeSecurityModule = {
  buildPicoWebLaunchSpec?: (runtimeDirectory: string, plantumlJar: string, port: number) => {
    executablePath: string
    args: string[]
  }
  assertLoopbackOnlyBindings?: (netstatOutput: string, port: number, processId: number) => void
  assertSandboxIncludeBlocked?: (response: PlantumlSmokeResponse, sentinel: string, expectedError: string) => void
  assertSandboxUrlIncludeBlocked?: (response: PlantumlSmokeResponse, sentinel: string, expectedError: string, requestCount: number) => void
  getPlantumlRuntimeMetadata?: (lock: unknown) => {
    plantumlJarName: string
    plantumlVersion: string
    plantumlLicenseName: string
    temurinLicenseName: string
  }
  cleanupPlantumlSmokeResources?: (resources: {
    stopChild?: () => Promise<void>
    closeCanary?: () => Promise<void>
    cleanupTemporaryFiles?: () => Promise<void>
  }) => Promise<void>
  assertSafeSmokeTempDirectory?: (directory: string) => Promise<string>
}

type PlantumlSmokeResponse = {
  status: number
  contentType: string
  diagramError: string | null
  body: string
}

const smokeModulePath = resolve(process.cwd(), 'scripts/test-plantuml-runtime.mjs')
let smokeModule: PlantumlSmokeSecurityModule = {}

beforeAll(async () => {
  smokeModule = await import(pathToFileURL(smokeModulePath).href) as PlantumlSmokeSecurityModule
})

describe('bundled PlantUML runtime security contract', () => {
  it('launches only the bundled Java with SANDBOX, disabled statistics, and loopback binding', () => {
    expect(smokeModule.buildPicoWebLaunchSpec).toBeTypeOf('function')
    if (!smokeModule.buildPicoWebLaunchSpec) return

    const runtimeDirectory = resolve(tmpdir(), 'trace-plantuml-runtime-security-fixture', 'runtime')
    const plantumlJar = resolve(runtimeDirectory, 'plantuml-lgpl-1.2026.8.jar')
    const spec = smokeModule.buildPicoWebLaunchSpec(runtimeDirectory, plantumlJar, 18080)

    expect(spec.executablePath).toBe(resolve(runtimeDirectory, 'bin/java.exe'))
    expect(spec.args).toContain('-DPLANTUML_SECURITY_PROFILE=SANDBOX')
    expect(spec.args).toContain('-disablestats')
    expect(spec.args).toContain(`-picoweb:18080:127.0.0.1`)
    expect(spec.args).toContain(plantumlJar)
    expect(spec.args).not.toContain('-allowlist')
  })

  it('derives the PlantUML version, JAR, and license names from the runtime lock', () => {
    expect(smokeModule.getPlantumlRuntimeMetadata).toBeTypeOf('function')
    if (!smokeModule.getPlantumlRuntimeMetadata) return

    expect(smokeModule.getPlantumlRuntimeMetadata({
      plantuml: {
        fileName: 'plantuml-lgpl-9.8.7.jar',
        version: '9.8.7',
        licenseFile: 'scripts/plantuml-licenses/PLANTUML-LICENSE.txt'
      },
      temurin: { licenseFile: 'scripts/plantuml-licenses/TEMURIN-NOTICE.txt' }
    })).toEqual({
      plantumlJarName: 'plantuml-lgpl-9.8.7.jar',
      plantumlVersion: '9.8.7',
      plantumlLicenseName: 'PLANTUML-LICENSE.txt',
      temurinLicenseName: 'TEMURIN-NOTICE.txt'
    })
  })

  it('accepts only an exact loopback listener owned by the runtime process', () => {
    expect(smokeModule.assertLoopbackOnlyBindings).toBeTypeOf('function')
    if (!smokeModule.assertLoopbackOnlyBindings) return

    const expectedBinding = '  TCP    127.0.0.1:18080    0.0.0.0:0    LISTENING    4512'
    expect(() => smokeModule.assertLoopbackOnlyBindings?.(expectedBinding, 18080, 4512)).not.toThrow()
    expect(() => smokeModule.assertLoopbackOnlyBindings?.(
      `${expectedBinding}\n  TCP    192.168.1.45:18080    0.0.0.0:0    LISTENING    4512`,
      18080,
      4512
    )).toThrow(/loopback/i)
    expect(() => smokeModule.assertLoopbackOnlyBindings?.(
      '  TCP    0.0.0.0:18080    0.0.0.0:0    LISTENING    4512',
      18080,
      4512
    )).toThrow(/loopback/i)
  })

  it('fails when a local include exposes file contents', () => {
    expect(smokeModule.assertSandboxIncludeBlocked).toBeTypeOf('function')
    if (!smokeModule.assertSandboxIncludeBlocked) return

    const sentinel = 'TRACE_LOCAL_INCLUDE_MUST_STAY_PRIVATE'
    const expectedError = 'cannot include local-canary.iuml'
    const deniedResponse: PlantumlSmokeResponse = {
      status: 400,
      contentType: 'image/svg+xml',
      diagramError: expectedError,
      body: '<svg><text>PlantUML error</text></svg>'
    }
    expect(() => smokeModule.assertSandboxIncludeBlocked?.(deniedResponse, sentinel, expectedError)).not.toThrow()
    expect(() => smokeModule.assertSandboxIncludeBlocked?.({ ...deniedResponse, status: 200 }, sentinel, expectedError)).toThrow(/HTTP 400/i)
    expect(() => smokeModule.assertSandboxIncludeBlocked?.({ ...deniedResponse, contentType: 'text/html' }, sentinel, expectedError)).toThrow(/SVG/i)
    expect(() => smokeModule.assertSandboxIncludeBlocked?.({ ...deniedResponse, diagramError: 'Syntax Error' }, sentinel, expectedError)).toThrow(/expected PlantUML refusal/i)
    expect(() => smokeModule.assertSandboxIncludeBlocked?.({ ...deniedResponse, body: `<svg>${sentinel}</svg>` }, sentinel, expectedError)).toThrow(/local file/i)
  })

  it('fails when a URL include reaches its loopback canary or exposes its response', () => {
    expect(smokeModule.assertSandboxUrlIncludeBlocked).toBeTypeOf('function')
    if (!smokeModule.assertSandboxUrlIncludeBlocked) return

    const sentinel = 'TRACE_URL_INCLUDE_MUST_STAY_PRIVATE'
    const expectedError = 'Cannot open URL'
    const deniedResponse: PlantumlSmokeResponse = {
      status: 400,
      contentType: 'image/svg+xml',
      diagramError: expectedError,
      body: '<svg><text>PlantUML error</text></svg>'
    }
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.(deniedResponse, sentinel, expectedError, 0)).not.toThrow()
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.({ ...deniedResponse, status: 503 }, sentinel, expectedError, 0)).toThrow(/HTTP 400/i)
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.({ ...deniedResponse, contentType: 'text/html' }, sentinel, expectedError, 0)).toThrow(/SVG/i)
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.({ ...deniedResponse, diagramError: 'Renderer failed' }, sentinel, expectedError, 0)).toThrow(/expected PlantUML refusal/i)
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.(deniedResponse, sentinel, expectedError, 1)).toThrow(/canary/i)
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.({ ...deniedResponse, body: `<svg>${sentinel}</svg>` }, sentinel, expectedError, 0)).toThrow(/URL include/i)
  })

  it('attempts canary and temporary-directory cleanup even when child stop and canary close fail', async () => {
    expect(smokeModule.cleanupPlantumlSmokeResources).toBeTypeOf('function')
    if (!smokeModule.cleanupPlantumlSmokeResources) return

    const stopFailure = new Error('child stop failed')
    const closeFailure = new Error('canary close failed')
    const stopChild = vi.fn(async () => { throw stopFailure })
    const closeCanary = vi.fn(async () => { throw closeFailure })
    const cleanupTemporaryFiles = vi.fn(async () => undefined)

    await expect(smokeModule.cleanupPlantumlSmokeResources({ stopChild, closeCanary, cleanupTemporaryFiles }))
      .rejects.toMatchObject({ errors: [stopFailure, closeFailure] })
    expect(stopChild).toHaveBeenCalledOnce()
    expect(closeCanary).toHaveBeenCalledOnce()
    expect(cleanupTemporaryFiles).toHaveBeenCalledOnce()
  })

  it('cleans the canary and temp directory after a successful child stop', async () => {
    expect(smokeModule.cleanupPlantumlSmokeResources).toBeTypeOf('function')
    if (!smokeModule.cleanupPlantumlSmokeResources) return

    const stopChild = vi.fn(async () => undefined)
    const closeCanary = vi.fn(async () => undefined)
    const cleanupTemporaryFiles = vi.fn(async () => undefined)

    await expect(smokeModule.cleanupPlantumlSmokeResources({ stopChild, closeCanary, cleanupTemporaryFiles })).resolves.toBeUndefined()
    expect(stopChild).toHaveBeenCalledOnce()
    expect(closeCanary).toHaveBeenCalledOnce()
    expect(cleanupTemporaryFiles).toHaveBeenCalledOnce()
  })

  it('rejects temp cleanup targets outside the system temp directory before filesystem cleanup', async () => {
    expect(smokeModule.assertSafeSmokeTempDirectory).toBeTypeOf('function')
    if (!smokeModule.assertSafeSmokeTempDirectory) return

    const outsideDirectory = resolve(tmpdir(), '..', 'trace-plantuml-runtime-smoke-unowned')
    await expect(smokeModule.assertSafeSmokeTempDirectory(outsideDirectory)).rejects.toThrow(/outside the system temporary directory/i)
    await expect(smokeModule.assertSafeSmokeTempDirectory(resolve(tmpdir(), 'unowned-smoke-directory')))
      .rejects.toThrow(/not created by this smoke test/i)
  })
})

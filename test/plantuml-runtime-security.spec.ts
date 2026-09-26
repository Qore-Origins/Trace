import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type PlantumlSmokeSecurityModule = {
  buildPicoWebLaunchSpec?: (runtimeDirectory: string, plantumlJar: string, port: number) => {
    executablePath: string
    args: string[]
  }
  assertLoopbackOnlyBindings?: (netstatOutput: string, port: number, processId: number) => void
  assertSandboxIncludeBlocked?: (responseBody: string, sentinel: string) => void
  assertSandboxUrlIncludeBlocked?: (responseBody: string, sentinel: string, requestCount: number) => void
  getPlantumlRuntimeMetadata?: (lock: unknown) => {
    plantumlJarName: string
    plantumlVersion: string
    plantumlLicenseName: string
    temurinLicenseName: string
  }
}

const smokeModulePath = resolve(process.cwd(), 'scripts/test-plantuml-runtime.mjs')
let smokeModule: PlantumlSmokeSecurityModule = {}
let temporaryDirectory: string

beforeAll(async () => {
  smokeModule = await import(pathToFileURL(smokeModulePath).href) as PlantumlSmokeSecurityModule
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'trace-plantuml-runtime-security-'))
})

afterAll(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true })
})

describe('bundled PlantUML runtime security contract', () => {
  it('launches only the bundled Java with SANDBOX, disabled statistics, and loopback binding', () => {
    expect(smokeModule.buildPicoWebLaunchSpec).toBeTypeOf('function')
    if (!smokeModule.buildPicoWebLaunchSpec) return

    const runtimeDirectory = resolve(temporaryDirectory, 'runtime')
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
    expect(() => smokeModule.assertSandboxIncludeBlocked?.('<svg><text>blocked</text></svg>', sentinel)).not.toThrow()
    expect(() => smokeModule.assertSandboxIncludeBlocked?.(`<svg><text>${sentinel}</text></svg>`, sentinel)).toThrow(/local file/i)
  })

  it('fails when a URL include reaches its loopback canary or exposes its response', () => {
    expect(smokeModule.assertSandboxUrlIncludeBlocked).toBeTypeOf('function')
    if (!smokeModule.assertSandboxUrlIncludeBlocked) return

    const sentinel = 'TRACE_URL_INCLUDE_MUST_STAY_PRIVATE'
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.('<svg><text>blocked</text></svg>', sentinel, 0)).not.toThrow()
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.('<svg><text>blocked</text></svg>', sentinel, 1)).toThrow(/canary/i)
    expect(() => smokeModule.assertSandboxUrlIncludeBlocked?.(`<svg><text>${sentinel}</text></svg>`, sentinel, 0)).toThrow(/URL include/i)
  })
})

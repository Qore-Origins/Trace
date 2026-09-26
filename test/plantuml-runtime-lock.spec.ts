import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

type AssetLock = {
  version: string
  fileName: string
  url: string
  sha256: string
  sizeBytes: number
}

type RuntimeLock = {
  schemaVersion: number
  target: {
    os: string
    architecture: string
    platform: string
  }
  plantuml: AssetLock & { distribution: string; spdx: string }
  temurin: AssetLock & { distribution: string }
  modules: string[]
}

type RuntimePreparationModule = {
  validateRuntimeLock?: (candidate: unknown) => void
}

const runtimeLockPath = resolve(process.cwd(), 'scripts/plantuml-runtime.lock.json')
const runtimePreparationPath = resolve(process.cwd(), 'scripts/prepare-plantuml-runtime.mjs')
const lock = JSON.parse(readFileSync(runtimeLockPath, 'utf8')) as RuntimeLock
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const gitignore = readFileSync(resolve(process.cwd(), '.gitignore'), 'utf8')

let validateRuntimeLock: RuntimePreparationModule['validateRuntimeLock']
let preparationImportError: unknown

beforeAll(async () => {
  try {
    const loadedModule = await import(pathToFileURL(runtimePreparationPath).href) as RuntimePreparationModule
    validateRuntimeLock = loadedModule.validateRuntimeLock
  } catch (error) {
    preparationImportError = error
  }
})

afterAll(() => {
  validateRuntimeLock = undefined
  preparationImportError = undefined
})

describe('PlantUML runtime lock', () => {
  it('pins official fixed Windows x64 assets with byte-level hashes', () => {
    expect(lock.schemaVersion).toBe(1)
    expect(lock.target).toEqual({ os: 'windows', architecture: 'x64', platform: 'windows-x64' })

    expect(lock.plantuml).toMatchObject({
      version: '1.2026.8',
      distribution: 'LGPL',
      spdx: 'LGPL-3.0-or-later',
      url: 'https://github.com/plantuml/plantuml/releases/download/v1.2026.8/plantuml-lgpl-1.2026.8.jar'
    })
    expect(lock.temurin).toMatchObject({
      version: '21.0.12+8',
      distribution: 'Eclipse Temurin',
      url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip'
    })

    for (const asset of [lock.plantuml, lock.temurin]) {
      expect(asset.url.startsWith('https://github.com/')).toBe(true)
      expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/i)
      expect(asset.sizeBytes).toBeGreaterThan(0)
      expect(new URL(asset.url).pathname.split('/').at(-1)).toBe(asset.fileName)
    }
  })

  it('keeps a non-empty unique list of legal Java module roots', () => {
    expect(lock.modules.length).toBeGreaterThan(0)
    expect(new Set(lock.modules).size).toBe(lock.modules.length)
    expect(lock.modules.every((moduleName) => /^java\.[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/.test(moduleName))).toBe(true)
  })

  it('exports a side-effect-free validator for the same lock contract', () => {
    expect(validateRuntimeLock, String(preparationImportError ?? 'runtime preparation module is missing')).toBeTypeOf('function')
    if (typeof validateRuntimeLock !== 'function') return

    expect(() => validateRuntimeLock(lock)).not.toThrow()
    expect(() => validateRuntimeLock({ ...lock, plantuml: { ...lock.plantuml, sha256: 'bad' } })).toThrow(/SHA-256/i)
    expect(() => validateRuntimeLock({ ...lock, temurin: { ...lock.temurin, url: 'https://example.invalid/jdk.zip' } })).toThrow(/official|URL/i)
    expect(() => validateRuntimeLock({ ...lock, modules: [...lock.modules, lock.modules[0]] })).toThrow(/unique|duplicate/i)
    expect(() => validateRuntimeLock({ ...lock, modules: ['java/not-a-module'] })).toThrow(/module/i)
  })

  it('registers the prepare npm script', () => {
    expect(packageJson.scripts['plantuml:prepare']).toBe('node scripts/prepare-plantuml-runtime.mjs')
  })

  it('ignores only the generated PlantUML runtime directory', () => {
    expect(gitignore.split(/\r?\n/)).toContain('.build/plantuml-runtime')
  })
})

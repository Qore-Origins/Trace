import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = process.cwd()
const builderConfig = readFileSync(resolve(repositoryRoot, 'electron-builder.yml'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const runtimeLock = JSON.parse(readFileSync(resolve(repositoryRoot, 'scripts/plantuml-runtime.lock.json'), 'utf8')) as {
  plantuml: { fileName: string; licenseFile: string }
  temurin: { licenseFile: string }
}
const preparationScript = readFileSync(resolve(repositoryRoot, 'scripts/prepare-plantuml-runtime.mjs'), 'utf8')
const mainEntry = readFileSync(resolve(repositoryRoot, 'src/main/index.ts'), 'utf8')

describe('offline PlantUML packaging', () => {
  it('copies the prepared runtime to the app resources directory outside ASAR', () => {
    const resourceSection = builderConfig.match(/^extraResources:\r?\n((?: {2,}.*\r?\n|\r?\n)+)/m)?.[0]
    expect(resourceSection).toBeDefined()
    expect(resourceSection).toContain('from: .build/plantuml-runtime')
    expect(resourceSection).toMatch(/^    to: plantuml\s*$/m)
    expect(resourceSection).toContain("'!**/.trace-plantuml-runtime-owner.json'")
    expect(resourceSection).not.toContain("'!**/manifest.json'")
    expect(resourceSection).not.toContain("'!**/bin/**'")
    expect(resourceSection).not.toContain("'!**/lib/**'")
    expect(resourceSection).not.toContain(`'!**/${runtimeLock.plantuml.fileName}'`)
    expect(resourceSection).not.toContain("'!**/LICENSES/**'")

    expect(mainEntry).toMatch(/app\.isPackaged\s*\?\s*join\(process\.resourcesPath,\s*'plantuml'\)/)
    expect(mainEntry).not.toMatch(/join\(process\.cwd\(\),\s*['"]\.build\/plantuml-runtime/)
  })

  it('includes the two locked upstream license documents under the packaged LICENSES directory', () => {
    expect(runtimeLock.plantuml.licenseFile).toBe('scripts/plantuml-licenses/PLANTUML-LICENSE.txt')
    expect(runtimeLock.temurin.licenseFile).toBe('scripts/plantuml-licenses/TEMURIN-NOTICE.txt')
    expect(preparationScript).toContain("resolve(payloadPath, 'LICENSES')")
    expect(preparationScript).toContain("file.path === `LICENSES/${license.fileName}`")
    expect(builderConfig).toContain('to: plantuml')
    expect(builderConfig).toContain("'**/*'")
    expect(builderConfig).not.toContain("'!**/LICENSES/**'")
  })

  it('prepares the runtime before the Windows renderer and installer builds', () => {
    expect(packageJson.scripts['build:win']).toMatch(
      /^npm run plantuml:prepare\s*&&\s*electron-vite build\s*&&\s*electron-builder --win --x64$/
    )
  })

  it('keeps ordinary build, typecheck, and tests independent from runtime downloads', () => {
    for (const scriptName of ['build', 'typecheck', 'typecheck:node', 'typecheck:web', 'test']) {
      expect(packageJson.scripts[scriptName], `${scriptName} must stay offline`).not.toContain('plantuml:prepare')
    }
  })
})

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PlanNameTemplateService } from '../src/main/services/plan-name-template-service'
import { PlanRepository } from '../src/main/services/plan-repository'
import { ERR } from '../src/shared/errors'

let roots: string[]
let service: PlanNameTemplateService

beforeEach(async () => {
  roots = []
  service = new PlanNameTemplateService(new PlanRepository())
})

afterEach(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function makeLibrary(name: string): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), `trace-plan-template-${name}-`))
  roots.push(root)
  return root
}

async function makeFolder(root: string, parentPath: string): Promise<void> {
  await fs.mkdir(join(root, parentPath), { recursive: true })
}

describe('PlanNameTemplateService', () => {
  it('returns built-in defaults without writing a config file when it is missing', async () => {
    const root = await makeLibrary('defaults')

    await expect(service.get(root)).resolves.toEqual({
      rules: [
        { parent_path: 'Daily_Plan', template: 'Daily-Plan_{date}_{title}', source: 'default' },
        { parent_path: 'Future_Plan', template: 'Future_Plan-{date}-{title}', source: 'default' },
        { parent_path: 'Weekly_Plan', template: 'Weekly_Plan_{date}_{title}', source: 'default' },
        { parent_path: 'Short-Term_Plan', template: 'Short-Term_Plan_{date}_{title}', source: 'default' },
        { parent_path: 'Medium-Term_Plan', template: 'Medium-Term_Plan_{date}_{title}', source: 'default' },
        { parent_path: 'Long-Term_Plan', template: 'Long-Term_Plan_{date}_{title}', source: 'default' }
      ],
      disabled_default_paths: []
    })
    await expect(fs.access(join(root, '.trace', 'plan-name-templates.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('stores exact parent-folder rules per library and writes atomically', async () => {
    const firstRoot = await makeLibrary('first')
    const secondRoot = await makeLibrary('second')
    await makeFolder(firstRoot, 'Daily_Plan/Archive')
    await makeFolder(secondRoot, 'Daily_Plan/Archive')

    const saved = await service.set(firstRoot, 'Daily_Plan/Archive', 'Archive_{title}')
    const firstSettings = await service.get(firstRoot)
    const secondSettings = await service.get(secondRoot)

    expect(saved.rules).toContainEqual({
      parent_path: 'Daily_Plan/Archive',
      template: 'Archive_{title}',
      source: 'custom'
    })
    expect(firstSettings.rules).toContainEqual({
      parent_path: 'Daily_Plan',
      template: 'Daily-Plan_{date}_{title}',
      source: 'default'
    })
    expect(secondSettings.rules).not.toContainEqual(expect.objectContaining({ parent_path: 'Daily_Plan/Archive' }))
    const configPath = join(firstRoot, '.trace', 'plan-name-templates.json')
    await expect(fs.readFile(configPath, 'utf8')).resolves.toMatch(/"Daily_Plan\/Archive": "Archive_\{title\}"/)
    await expect(fs.readdir(join(firstRoot, '.trace'))).resolves.toEqual(['plan-name-templates.json'])
  })

  it('rejects invalid templates and unsafe or missing parent folders without creating config', async () => {
    const root = await makeLibrary('reject-invalid')
    await makeFolder(root, 'Daily_Plan')

    await expect(service.set(root, 'Daily_Plan', 'Daily_{month}_{title}')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, 'Daily_Plan', 'Daily_{date}')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, 'Daily_Plan', 'Bad/{title}')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, 'Daily_Plan', '{title}.')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, 'Daily_Plan', `${'x'.repeat(255)}{title}`)).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, '../outside', 'Plan_{title}')).rejects.toMatchObject({ code: ERR.PATH_UNSAFE })
    await expect(service.set(root, 'Missing', 'Plan_{title}')).rejects.toMatchObject({ code: ERR.PATH_NOT_FOUND })
    await expect(fs.access(join(root, '.trace', 'plan-name-templates.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('does not overwrite a valid stored rule when an invalid template is rejected', async () => {
    const root = await makeLibrary('preserve-valid-rule')
    await makeFolder(root, 'Notes')
    await service.set(root, 'Notes', 'Plan_{title}')

    const configPath = join(root, '.trace', 'plan-name-templates.json')
    const validConfig = await fs.readFile(configPath, 'utf8')
    await expect(service.set(root, 'Notes', 'Bad/{title}')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(service.set(root, 'Notes', '{title}.')).rejects.toMatchObject({ code: ERR.VALIDATION })
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(validConfig)
  })

  it('preserves malformed configuration when reads and mutations fail', async () => {
    const root = await makeLibrary('malformed')
    await makeFolder(root, 'Daily_Plan')
    await fs.mkdir(join(root, '.trace'))
    const configPath = join(root, '.trace', 'plan-name-templates.json')
    const malformed = '{"format_version":"1","templates":{"Daily_Plan":"Bad/{title}"},"disabled_default_paths":[]}'
    await fs.writeFile(configPath, malformed, 'utf8')

    await expect(service.get(root)).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    await expect(service.set(root, 'Daily_Plan', 'Plan_{title}')).rejects.toMatchObject({ code: ERR.FORMAT_INVALID })
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(malformed)
  })

  it('keeps removed built-ins disabled and removes custom overrides only', async () => {
    const root = await makeLibrary('remove')
    await makeFolder(root, 'Daily_Plan')
    await makeFolder(root, 'Notes')

    const disabled = await service.remove(root, 'Daily_Plan')
    expect(disabled.rules).not.toContainEqual(expect.objectContaining({ parent_path: 'Daily_Plan' }))
    expect(disabled.disabled_default_paths).toContain('Daily_Plan')
    expect((await service.get(root)).disabled_default_paths).toContain('Daily_Plan')

    const reenabled = await service.set(root, 'Daily_Plan', 'Daily_{title}')
    expect(reenabled.rules).toContainEqual({ parent_path: 'Daily_Plan', template: 'Daily_{title}', source: 'custom' })
    expect(reenabled.disabled_default_paths).not.toContain('Daily_Plan')
    const disabledAgain = await service.remove(root, 'Daily_Plan')
    expect(disabledAgain.rules).not.toContainEqual(expect.objectContaining({ parent_path: 'Daily_Plan' }))
    expect(disabledAgain.disabled_default_paths).toContain('Daily_Plan')

    await service.set(root, 'Notes', 'Notes_{title}')
    const withoutCustom = await service.remove(root, 'Notes')
    expect(withoutCustom.rules).not.toContainEqual(expect.objectContaining({ parent_path: 'Notes' }))
    expect(withoutCustom.disabled_default_paths).toEqual(['Daily_Plan'])
  })
})

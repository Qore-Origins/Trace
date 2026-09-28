import { promises as fs } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import {
  BUILT_IN_PLAN_NAME_TEMPLATES,
  validatePlanNameTemplate,
  type PlanNameTemplateConfig,
  type PlanNameTemplateRule,
  type PlanNameTemplateSettings
} from '../../shared/plan-name-templates'
import { ERR, TraceError } from '../../shared/errors'
import { validatePlanName } from '../../shared/validation'
import { PlanRepository } from './plan-repository'
import { resolveWithin } from './path-safety'

const CONFIG_REL_PATH = '.trace/plan-name-templates.json'
const BUILT_IN_TEMPLATES: ReadonlyMap<string, string> = new Map(
  BUILT_IN_PLAN_NAME_TEMPLATES.map(({ parent_path, template }) => [parent_path, template])
)

function emptyConfig(): PlanNameTemplateConfig {
  return { format_version: '1', templates: {}, disabled_default_paths: [] }
}

function invalidConfig(): TraceError {
  return new TraceError(ERR.FORMAT_INVALID, '计划名称模板配置损坏，原文件已保留')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function isPathWithin(parent: string, child: string): boolean {
  const fromParent = relative(parent, child)
  return fromParent === '' || (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
}

async function assertRealPathWithinRoot(rootAbs: string, targetAbs: string): Promise<void> {
  let rootReal: string
  let targetReal: string
  try {
    ;[rootReal, targetReal] = await Promise.all([fs.realpath(rootAbs), fs.realpath(targetAbs)])
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TraceError(ERR.PATH_NOT_FOUND, '目标文件夹不存在')
    }
    throw error
  }
  if (!isPathWithin(rootReal, targetReal)) throw new TraceError(ERR.PATH_UNSAFE, '路径越界被拒绝')
}

function validateStoredParentPath(rootAbs: string, parentPath: unknown): string {
  if (typeof parentPath !== 'string') throw invalidConfig()
  let resolved: ReturnType<typeof resolveWithin>
  try {
    resolved = resolveWithin(rootAbs, parentPath)
  } catch {
    throw invalidConfig()
  }
  const segments = resolved.rel === '' ? [] : resolved.rel.split('/')
  if (resolved.rel !== parentPath || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw invalidConfig()
  }
  return resolved.rel
}

async function validateExistingParentFolder(rootAbs: string, parentPath: unknown): Promise<string> {
  if (typeof parentPath !== 'string') throw new TraceError(ERR.VALIDATION, '父文件夹路径必须为文本')

  let resolved: ReturnType<typeof resolveWithin>
  try {
    resolved = resolveWithin(rootAbs, parentPath)
  } catch (error) {
    if (error instanceof TraceError) throw error
    throw new TraceError(ERR.PATH_UNSAFE, '父文件夹路径无效')
  }
  const segments = resolved.rel === '' ? [] : resolved.rel.split('/')
  if (resolved.rel !== parentPath || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TraceError(ERR.PATH_UNSAFE, '父文件夹路径必须为标准相对路径')
  }
  for (const segment of segments) validatePlanName(segment)

  try {
    const stat = await fs.stat(resolved.abs)
    if (!stat.isDirectory()) throw new TraceError(ERR.PATH_NOT_FOUND, '目标父文件夹不存在')
  } catch (error) {
    if (error instanceof TraceError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TraceError(ERR.PATH_NOT_FOUND, '目标父文件夹不存在')
    }
    throw error
  }
  await assertRealPathWithinRoot(rootAbs, resolved.abs)
  return resolved.rel
}

function settingsFromConfig(config: PlanNameTemplateConfig): PlanNameTemplateSettings {
  const disabledPaths = new Set(config.disabled_default_paths)
  const rules: PlanNameTemplateRule[] = []
  for (const { parent_path, template } of BUILT_IN_PLAN_NAME_TEMPLATES) {
    if (Object.hasOwn(config.templates, parent_path)) {
      rules.push({ parent_path, template: config.templates[parent_path], source: 'custom' })
      continue
    }
    if (!disabledPaths.has(parent_path)) rules.push({ parent_path, template, source: 'default' })
  }

  const builtInPaths = new Set(BUILT_IN_TEMPLATES.keys())
  const customRules = Object.entries(config.templates)
    .filter(([parent_path]) => !builtInPaths.has(parent_path))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([parent_path, template]) => ({ parent_path, template, source: 'custom' as const }))

  return {
    rules: [...rules, ...customRules],
    disabled_default_paths: BUILT_IN_PLAN_NAME_TEMPLATES
      .map(({ parent_path }) => parent_path)
      .filter((parent_path) => disabledPaths.has(parent_path))
  }
}

export class PlanNameTemplateService {
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly repository: PlanRepository) {}

  async get(rootAbs: string): Promise<PlanNameTemplateSettings> {
    return settingsFromConfig(await this.readConfig(rootAbs))
  }

  async set(rootAbs: string, parentPath: unknown, template: unknown): Promise<PlanNameTemplateSettings> {
    const normalizedParent = await validateExistingParentFolder(rootAbs, parentPath)
    validatePlanNameTemplate(template)

    return this.serialize(async () => {
      const config = await this.readConfig(rootAbs)
      const templates = Object.fromEntries(Object.entries(config.templates)) as Record<string, string>
      Object.defineProperty(templates, normalizedParent, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: template
      })
      const next: PlanNameTemplateConfig = {
        format_version: '1',
        templates,
        disabled_default_paths: config.disabled_default_paths.filter((path) => path !== normalizedParent)
      }
      await this.writeConfig(rootAbs, next)
      return settingsFromConfig(next)
    })
  }

  async remove(rootAbs: string, parentPath: unknown): Promise<PlanNameTemplateSettings> {
    const normalizedParent = await validateExistingParentFolder(rootAbs, parentPath)

    return this.serialize(async () => {
      const config = await this.readConfig(rootAbs)
      const hasOverride = Object.hasOwn(config.templates, normalizedParent)
      const isBuiltIn = BUILT_IN_TEMPLATES.has(normalizedParent)
      const alreadyDisabled = config.disabled_default_paths.includes(normalizedParent)
      if (!hasOverride && (!isBuiltIn || alreadyDisabled)) return settingsFromConfig(config)

      const templates = Object.fromEntries(
        Object.entries(config.templates).filter(([path]) => path !== normalizedParent)
      ) as Record<string, string>
      const disabledDefaultPaths = isBuiltIn
        ? [...config.disabled_default_paths.filter((path) => path !== normalizedParent), normalizedParent]
        : config.disabled_default_paths
      const next: PlanNameTemplateConfig = {
        format_version: '1',
        templates,
        disabled_default_paths: disabledDefaultPaths
      }
      await this.writeConfig(rootAbs, next)
      return settingsFromConfig(next)
    })
  }

  private async readConfig(rootAbs: string): Promise<PlanNameTemplateConfig> {
    const configPath = resolveWithin(rootAbs, CONFIG_REL_PATH).abs
    const traceDirectoryExists = await this.validateTraceDirectory(rootAbs)
    if (!traceDirectoryExists) return emptyConfig()

    let raw: string
    try {
      const stat = await fs.lstat(configPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw invalidConfig()
      raw = await fs.readFile(configPath, 'utf8')
    } catch (error) {
      if (error instanceof TraceError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
      throw error
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw invalidConfig()
    }
    if (!isRecord(parsed)) throw invalidConfig()
    const keys = Object.keys(parsed)
    if (
      keys.length !== 3 ||
      !keys.includes('format_version') ||
      !keys.includes('templates') ||
      !keys.includes('disabled_default_paths') ||
      parsed.format_version !== '1' ||
      !isRecord(parsed.templates) ||
      !Array.isArray(parsed.disabled_default_paths)
    ) {
      throw invalidConfig()
    }

    const entries: Array<[string, string]> = []
    try {
      for (const [parentPath, template] of Object.entries(parsed.templates)) {
        validateStoredParentPath(rootAbs, parentPath)
        validatePlanNameTemplate(template)
        entries.push([parentPath, template])
      }
      const disabledDefaultPaths = parsed.disabled_default_paths
      if (
        disabledDefaultPaths.some((path) => typeof path !== 'string' || !BUILT_IN_TEMPLATES.has(path)) ||
        new Set(disabledDefaultPaths).size !== disabledDefaultPaths.length
      ) {
        throw invalidConfig()
      }
      return {
        format_version: '1',
        templates: Object.fromEntries(entries),
        disabled_default_paths: [...disabledDefaultPaths] as string[]
      }
    } catch {
      throw invalidConfig()
    }
  }

  private async writeConfig(rootAbs: string, config: PlanNameTemplateConfig): Promise<void> {
    const traceDirectoryExists = await this.validateTraceDirectory(rootAbs)
    if (!traceDirectoryExists) await assertRealPathWithinRoot(rootAbs, rootAbs)
    const configPath = resolveWithin(rootAbs, CONFIG_REL_PATH).abs
    await this.repository.writeAppJson(configPath, config)
  }

  private async validateTraceDirectory(rootAbs: string): Promise<boolean> {
    const traceDirectory = resolveWithin(rootAbs, '.trace').abs
    try {
      const stat = await fs.lstat(traceDirectory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new TraceError(ERR.PATH_UNSAFE, '模板配置目录路径不安全')
      await assertRealPathWithinRoot(rootAbs, traceDirectory)
      return true
    } catch (error) {
      if (error instanceof TraceError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const current = this.writeQueue.then(operation)
    this.writeQueue = current.then(() => undefined, () => undefined)
    return current
  }
}

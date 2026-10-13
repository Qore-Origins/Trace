import type { PlanNameTemplateSettings } from '../../shared/plan-name-templates'
import type { PlanWorkflowConfig, WorkflowPreset } from '../../shared/plan-workflow-types'
import { ERR, TraceError } from '../../shared/errors'

export type WorkflowPresetMatch =
  | { kind: 'matched'; preset: WorkflowPreset }
  | { kind: 'candidates'; presets: WorkflowPreset[] }
  | { kind: 'none' }

export type WorkflowNameRuleMatch =
  | { template: string; source: 'legacy-custom' | 'built-in' }
  | { template: string; source: 'category' | 'global'; ruleId: string }
  | { template: null; source: 'manual' }

export function resolveWorkflowPreset(config: PlanWorkflowConfig, selectedPath: string): WorkflowPresetMatch {
  const selected = validateSelectedPath(selectedPath)
  const defaults = config.presets.filter((preset) => preset.enabled && preset.is_default)
  const tiers = [
    defaults.filter((preset) => preset.scope.kind === 'directory' && preset.scope.path === selected),
    defaults.filter((preset) => preset.scope.kind === 'category' && matchesCategory(preset.scope.path, selected)),
    defaults.filter((preset) => preset.scope.kind === 'global')
  ]

  for (const tier of tiers) {
    if (tier.length === 1) return { kind: 'matched', preset: tier[0] }
    if (tier.length > 1) return { kind: 'candidates', presets: tier }
  }
  return { kind: 'none' }
}

export function resolveNameRule(
  config: PlanWorkflowConfig,
  legacy: PlanNameTemplateSettings,
  destinationPath: string
): WorkflowNameRuleMatch {
  const destination = validateSelectedPath(destinationPath)
  const exactCustom = legacy.rules.find(
    (rule) => rule.parent_path === destination && rule.source === 'custom'
  )
  if (exactCustom) return { template: exactCustom.template, source: 'legacy-custom' }

  const category = config.name_rules.find(
    (rule) => rule.enabled && rule.scope.kind === 'category' && matchesCategory(rule.scope.path, destination)
  )
  if (category) return { template: category.template, source: 'category', ruleId: category.id }

  const global = config.name_rules.find((rule) => rule.enabled && rule.scope.kind === 'global')
  if (global) return { template: global.template, source: 'global', ruleId: global.id }

  const builtIn = legacy.rules.find(
    (rule) => rule.parent_path === destination && rule.source === 'default'
  )
  if (builtIn) return { template: builtIn.template, source: 'built-in' }
  return { template: null, source: 'manual' }
}

function matchesCategory(categoryPath: string, selectedPath: string): boolean {
  return selectedPath === categoryPath || selectedPath.startsWith(`${categoryPath}/`)
}

function validateSelectedPath(path: string): string {
  if (
    typeof path !== 'string' ||
    path.startsWith('/') ||
    path.includes('\\') ||
    /^[A-Za-z]:/.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..' || (segment === '' && path !== ''))
  ) {
    throw new TraceError(ERR.PATH_UNSAFE, '计划目录路径必须为标准相对路径')
  }
  return path
}

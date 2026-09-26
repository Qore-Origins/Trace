import type { IMuyaOptions } from '@muyajs/core'
import type { PlantUmlMode, PlantUmlStatusDto } from '@shared/plantuml-types'
import { validatePlantumlPort } from '@shared/plantuml-types'

const ALLOWED_PLANTUML_PROTOCOLS = new Set(['http:', 'https:'])

export type PlantumlRenderState = 'disabled' | 'starting' | 'error' | 'unconfigured' | 'ready'

export interface PlantumlRenderConfig {
  server: string | null
  state: PlantumlRenderState
}

export interface PlantumlRenderPreferences {
  plantumlHydrated: boolean
  plantumlMode: PlantUmlMode
  plantumlPort: number
  plantumlServer: string
}

export interface MuyaPlantumlOptionsTarget {
  setOptions: (options: Partial<IMuyaOptions>, forceRender?: boolean) => void
}

export type PlantumlRendererPreloader = () => Promise<unknown>

export const DEFAULT_PLANTUML_RENDER_CONFIG: PlantumlRenderConfig = {
  server: null,
  state: 'unconfigured'
}

export function validatePlantumlServer(value: string): string {
  const trimmedValue = value.trim()
  if (!trimmedValue) return ''

  let serverUrl: URL
  try {
    serverUrl = new URL(trimmedValue)
  } catch {
    throw new Error('PlantUML 服务地址必须是有效的 HTTP(S) URL')
  }

  if (!ALLOWED_PLANTUML_PROTOCOLS.has(serverUrl.protocol)) {
    throw new Error('PlantUML 服务地址只允许使用 HTTP 或 HTTPS')
  }

  return serverUrl.toString().replace(/\/$/, '')
}

/** Resolve the one PlantUML endpoint shared by note reading and editing. */
export function resolvePlantumlRenderConfig(
  preference: PlantumlRenderPreferences,
  status: PlantUmlStatusDto
): PlantumlRenderConfig {
  if (!preference.plantumlHydrated) return { ...DEFAULT_PLANTUML_RENDER_CONFIG }
  if (preference.plantumlMode === 'off') return { server: null, state: 'disabled' }

  if (preference.plantumlMode === 'custom') {
    try {
      const server = validatePlantumlServer(preference.plantumlServer)
      return server ? { server, state: 'ready' } : { server: null, state: 'unconfigured' }
    } catch {
      return { server: null, state: 'unconfigured' }
    }
  }

  let port: number
  try {
    port = validatePlantumlPort(preference.plantumlPort)
  } catch {
    return { server: null, state: 'unconfigured' }
  }

  if (status.state === 'running' && status.port === port) {
    return { server: `http://127.0.0.1:${port}/plantuml`, state: 'ready' }
  }
  // Local mode is selected, so an initial/stopped snapshot means startup is pending, not disabled.
  if (status.state === 'stopped' || status.state === 'starting' || status.state === 'running') {
    return { server: null, state: 'starting' }
  }
  if (status.state === 'error') return { server: null, state: 'error' }
  return { ...DEFAULT_PLANTUML_RENDER_CONFIG }
}

/** Muya receives an empty server unless the shared resolver granted a ready endpoint. */
export function getMuyaPlantumlServer(config: PlantumlRenderConfig): string {
  if (config.state !== 'ready') return ''
  try {
    return validatePlantumlServer(config.server ?? '')
  } catch {
    return ''
  }
}

/**
 * Keep Muya fail-closed while its shared renderer module is loading. The
 * caller's generation predicate prevents an older async preload from
 * restoring a server after the preference has changed or the editor unmounted.
 */
export async function applyMuyaPlantumlRenderConfig(
  muya: MuyaPlantumlOptionsTarget,
  config: PlantumlRenderConfig,
  preloadRenderer: PlantumlRendererPreloader,
  isCurrent: () => boolean = () => true
): Promise<void> {
  muya.setOptions({ plantumlServer: '' }, true)

  const server = getMuyaPlantumlServer(config)
  if (!server) return

  try {
    await preloadRenderer()
  } catch {
    return
  }

  if (!isCurrent()) return
  muya.setOptions({ plantumlServer: server }, true)
}

export function createMuyaOptions(plantumlServer: string): Partial<IMuyaOptions> {
  return {
    frontMatter: true,
    footnote: true,
    math: true,
    superSubScript: true,
    isGitlabCompatibilityEnabled: true,
    codeBlockLineNumbers: true,
    autoPairBracket: true,
    autoPairMarkdownSyntax: true,
    autoPairQuote: true,
    wrapCodeBlocks: true,
    plantumlServer: validatePlantumlServer(plantumlServer),
    mermaidTheme: 'default',
    vegaTheme: 'latimes',
    sequenceTheme: 'hand',
    preferLooseListItem: true,
    spellcheckEnabled: true,
    disableHtml: false
  }
}

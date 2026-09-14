import type { IMuyaOptions } from '@muyajs/core'

const ALLOWED_PLANTUML_PROTOCOLS = new Set(['http:', 'https:'])

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

import { describe, expect, it } from 'vitest'

import {
  createMuyaOptions,
  validatePlantumlServer
} from '../src/renderer/src/components/muya-note/muya-config'

describe('Muya note config', () => {
  it('默认启用实时写作能力与自动换行', () => {
    expect(createMuyaOptions('')).toMatchObject({
      autoPairMarkdownSyntax: true,
      autoPairBracket: true,
      autoPairQuote: true,
      wrapCodeBlocks: true,
      plantumlServer: ''
    })
  })

  it('PlantUML 只接受 HTTP(S)，空值表示离线', () => {
    expect(validatePlantumlServer('')).toBe('')
    expect(validatePlantumlServer('http://127.0.0.1:8080/plantuml')).toBe(
      'http://127.0.0.1:8080/plantuml'
    )
    expect(() => validatePlantumlServer('file:///tmp/a')).toThrow()
  })
})

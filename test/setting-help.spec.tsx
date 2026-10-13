// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import SettingHelp, { type SettingHelpTopic } from '../src/renderer/src/components/ui/SettingHelp'
import { i18n } from '../src/renderer/src/i18n'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'
import enUS from '../src/renderer/src/i18n/locales/en-US'

const topics: SettingHelpTopic[] = [
  'treeAnimation', 'moodAnimation', 'liveMarkdown', 'noteCodeWrap',
  'plantumlMode', 'plantumlPort', 'plantumlRemote', 'namingTemplates',
  'workflowPresets', 'workflowOutputs', 'workflowContent', 'workflowNameRules',
  'agentService', 'agentCapability'
]

describe('SettingHelp', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
    await i18n.changeLanguage('zh-CN')
  })

  it('keeps the help collapsed until the user opens it', async () => {
    await i18n.changeLanguage('zh-CN')
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(SettingHelp, { topic: 'plantumlRemote' })))

    const details = container.querySelector('details')
    expect(details?.open).toBe(false)
    expect(details?.querySelector('summary')?.textContent).toBe('使用说明')
    expect(Array.from(details?.querySelectorAll('dt') ?? []).map((node) => node.textContent)).toEqual(['功能', '设置目的', '适合谁', '设置效果'])
    expect(details?.textContent).toContain('PlantUML 源码会发送')

    details?.querySelector('summary')?.click()
    expect(details?.open).toBe(true)
  })

  it('provides all four explanations in both supported languages', () => {
    for (const locale of [zhCN, enUS]) {
      for (const topic of topics) {
        const copy = locale.settingsHelp.topics[topic]
        expect(copy.feature.trim()).not.toBe('')
        expect(copy.purpose.trim()).not.toBe('')
        expect(copy.audience.trim()).not.toBe('')
        expect(copy.effect.trim()).not.toBe('')
      }
    }
  })
})

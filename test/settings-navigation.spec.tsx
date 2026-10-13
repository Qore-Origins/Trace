// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import SettingsNavigation, { type SettingsNavigationItem, type SettingsSectionId } from '../src/renderer/src/components/SettingsNavigation'

const sections: readonly SettingsNavigationItem[] = [
  { id: 'general', label: '常规', icon: 'G' },
  { id: 'library', label: '计划库', icon: 'L' },
  { id: 'templates', label: '命名模板', icon: 'T' },
  { id: 'xiaoyuan', label: '小沅模型服务', icon: 'X' },
  { id: 'about', label: '关于与快捷键', icon: 'A' }
]

describe('SettingsNavigation', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  it('marks the selected category and changes it on click', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    let activeSection: SettingsSectionId = 'general'

    const renderNavigation = (): void => {
      root?.render(createElement(SettingsNavigation, {
        activeSection,
        label: '设置分类',
        sections,
        onSelect: (section: SettingsSectionId) => { activeSection = section; renderNavigation() }
      }))
    }

    await act(async () => renderNavigation())
    const navigationButtons = Array.from(container.querySelectorAll('button'))
    const templatesButton = navigationButtons.find((button) => button.textContent?.includes('命名模板'))

    expect(container.querySelector('nav')?.getAttribute('aria-label')).toBe('设置分类')
    expect(navigationButtons.find((button) => button.textContent?.includes('常规'))?.getAttribute('aria-current')).toBe('page')
    expect(templatesButton).toBeDefined()

    await act(async () => templatesButton?.click())

    expect(activeSection).toBe('templates')
    expect(templatesButton?.getAttribute('aria-current')).toBe('page')
  })
})

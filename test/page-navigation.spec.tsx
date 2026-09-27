// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TopBar from '../src/renderer/src/components/TopBar'
import { i18n } from '../src/renderer/src/i18n'
import { useUiStore } from '../src/renderer/src/stores/ui-store'

const pages = [
  { label: '计划', view: 'workspace' },
  { label: '日记', view: 'diary' },
  { label: '回忆', view: 'memories' }
] as const

let host: HTMLDivElement | undefined
let root: ReturnType<typeof createRoot> | undefined
let previousActEnvironment: unknown
let previousLanguage: string
let previousUiState: ReturnType<typeof useUiStore.getState>

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  previousLanguage = i18n.language
  previousUiState = useUiStore.getState()

  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  useUiStore.setState({ view: 'workspace' })

  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(createElement(TopBar))
  })
})

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount()
    })
    root = undefined
  }

  host?.remove()
  host = undefined
  useUiStore.setState(previousUiState, true)
  await i18n.changeLanguage(previousLanguage)

  if (previousActEnvironment === undefined) {
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  } else {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  }
})

function getNavigation(): HTMLElement {
  const navigation = host?.querySelector<HTMLElement>('.view-nav')
  if (!navigation) throw new Error('TopBar did not render its page navigation')
  return navigation
}

describe('TopBar page navigation', () => {
  it('has an accessible name independent from the View command menu', () => {
    expect(getNavigation().getAttribute('aria-label')).toBe('页面导航')
  })

  it('renders three native buttons in page order and changes the real UI store when clicked', async () => {
    const navigation = getNavigation()
    const buttons = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button'))

    expect(Array.from(navigation.children).map((child) => child.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
    expect(buttons).toHaveLength(3)
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(pages.map(({ label }) => label))
    expect(buttons.every((button) => button.type === 'button')).toBe(true)

    for (const [index, page] of pages.entries()) {
      const startingView = page.view === 'workspace' ? 'diary' : 'workspace'
      await act(async () => {
        useUiStore.getState().setView(startingView)
        buttons[index]?.click()
      })
      expect(useUiStore.getState().view).toBe(page.view)
    }
  })

  it('marks exactly the selected page as the current page', async () => {
    const navigation = getNavigation()

    for (const page of pages) {
      await act(async () => {
        useUiStore.getState().setView(page.view)
      })
      const currentButtons = Array.from(navigation.querySelectorAll<HTMLButtonElement>('button[aria-current="page"]'))

      expect(currentButtons).toHaveLength(1)
      expect(currentButtons[0]?.textContent?.trim()).toBe(page.label)
    }
  })
})

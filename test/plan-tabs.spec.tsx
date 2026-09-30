// @vitest-environment happy-dom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PlanTabs from '../src/renderer/src/components/PlanTabs'
import { i18n } from '../src/renderer/src/i18n'
import { useWorkspaceTabsStore } from '../src/renderer/src/stores/workspace-tabs-store'

const openPaths = [
  { path: 'Daily_Plan/First plan' },
  { path: 'Future_Plan/Second plan' },
  { path: 'Weekly_Plan/Third plan' }
]

let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let previousActEnvironment: unknown
let previousLanguage: string
let previousWorkspaceState: ReturnType<typeof useWorkspaceTabsStore.getState>
let activate: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>
let closeTab: ReturnType<typeof vi.fn<(path: string) => Promise<boolean>>>

beforeEach(async () => {
  previousActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  previousLanguage = i18n.language
  previousWorkspaceState = useWorkspaceTabsStore.getState()
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')

  activate = vi.fn(async () => true)
  closeTab = vi.fn(async () => true)
  useWorkspaceTabsStore.setState({
    open_paths: openPaths,
    active_path: openPaths[1]?.path ?? null,
    activate,
    closeTab
  })

  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement('div', { 'data-content-focus-target': '', tabIndex: -1 }, createElement(PlanTabs)))
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  host.remove()
  useWorkspaceTabsStore.setState(previousWorkspaceState, true)
  await i18n.changeLanguage(previousLanguage)

  if (previousActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
})

function tabs(): HTMLButtonElement[] {
  return Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
}

describe('PlanTabs', () => {
  it('renders plans in their opened order', () => {
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'First plan',
      'Second plan',
      'Third plan'
    ])
  })

  it('marks the store active path as the selected tab', () => {
    expect(tabs().filter((tab) => tab.getAttribute('aria-selected') === 'true')).toHaveLength(1)
    expect(tabs().find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent?.trim()).toBe('Second plan')
  })

  it('keeps a keyboard entry point when no tab is active', async () => {
    await act(async () => {
      useWorkspaceTabsStore.setState({ active_path: null })
    })

    expect(tabs().filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
    expect(tabs()[0]?.tabIndex).toBe(0)
  })

  it('activates the selected plan through the workspace tabs store', async () => {
    await act(async () => {
      tabs()[0]?.click()
    })

    expect(activate).toHaveBeenCalledExactlyOnceWith('Daily_Plan/First plan')
  })

  it('closes only the requested tab without activating it', async () => {
    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="关闭计划\u201cFirst plan\u201d"]')
    expect(closeButton).not.toBeNull()

    await act(async () => {
      closeButton?.click()
    })

    expect(closeTab).toHaveBeenCalledExactlyOnceWith('Daily_Plan/First plan')
    expect(activate).not.toHaveBeenCalled()
  })

  it('returns keyboard focus to an adjacent surviving tab after close', async () => {
    const closingPath = openPaths[1]?.path
    expect(closingPath).toBeDefined()
    closeTab.mockImplementationOnce(async (path) => {
      useWorkspaceTabsStore.setState((state) => ({
        open_paths: state.open_paths.filter((item) => item.path !== path),
        active_path: openPaths[0]?.path ?? null
      }))
      return true
    })
    const closeButton = host.querySelector<HTMLButtonElement>(`button[aria-label="关闭计划“Second plan”"]`)
    expect(closeButton).not.toBeNull()

    await act(async () => {
      closeButton?.focus()
      closeButton?.click()
      await vi.waitFor(() => expect(tabs()).toHaveLength(2))
    })

    expect(document.activeElement).toBe(tabs()[0])
  })

  it('moves focus to the content entry when closing the last tab', async () => {
    await act(async () => {
      useWorkspaceTabsStore.setState({ open_paths: [openPaths[0]!], active_path: openPaths[0]!.path })
    })
    closeTab.mockImplementationOnce(async (path) => {
      useWorkspaceTabsStore.setState((state) => ({
        open_paths: state.open_paths.filter((item) => item.path !== path),
        active_path: null
      }))
      return true
    })
    const closeButton = host.querySelector<HTMLButtonElement>('button.plan-tabs__close')
    const contentTarget = host.querySelector<HTMLElement>('[data-content-focus-target]')
    expect(closeButton).not.toBeNull()
    expect(contentTarget).not.toBeNull()

    await act(async () => {
      closeButton?.focus()
      closeButton?.click()
      await vi.waitFor(() => expect(tabs()).toHaveLength(0))
    })

    expect(document.activeElement).toBe(contentTarget)
  })

  it('gives the tab list and every keyboard-operable button a localized accessible name', () => {
    const tabList = host.querySelector<HTMLElement>('[role="tablist"]')
    expect(tabList?.getAttribute('aria-label')).toBe('已打开的计划')

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    expect(buttons.length).toBe(6)
    expect(buttons.every((button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()).length > 0)).toBe(true)
  })

  it('uses localized accessible labels when the interface language is English', async () => {
    await act(async () => {
      await i18n.changeLanguage('en-US')
    })

    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Open plans')
    expect(host.querySelector('button[aria-label="Close plan \u201cFirst plan\u201d"]')).not.toBeNull()
  })

  it('moves keyboard focus between tabs without duplicating selected state', async () => {
    const [first, second] = tabs()
    await act(async () => {
      first?.focus()
      first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(document.activeElement).toBe(second)
    expect(second?.getAttribute('aria-selected')).toBe('true')
    expect(first?.getAttribute('aria-selected')).toBe('false')
    expect(activate).not.toHaveBeenCalled()
  })
})

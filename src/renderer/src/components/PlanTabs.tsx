import { useEffect, useRef } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { useTranslation } from '../i18n'
import { useWorkspaceTabsStore } from '../stores/workspace-tabs-store'

function planName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

export default function PlanTabs(): React.JSX.Element | null {
  const { t } = useTranslation()
  const openPaths = useWorkspaceTabsStore((state) => state.open_paths)
  const activePath = useWorkspaceTabsStore((state) => state.active_path)
  const activate = useWorkspaceTabsStore((state) => state.activate)
  const closeTab = useWorkspaceTabsStore((state) => state.closeTab)
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())
  const tabListRef = useRef<HTMLDivElement | null>(null)
  const focusAfterClose = useRef<{
    closingPath: string
    focusPath: string | null
    contentTarget: HTMLElement | null
  } | null>(null)
  const selectedIndex = openPaths.findIndex((item) => item.path === activePath)

  useEffect(() => {
    const pending = focusAfterClose.current
    if (!pending || openPaths.some((item) => item.path === pending.closingPath)) return

    focusAfterClose.current = null
    if (pending.focusPath) tabRefs.current.get(pending.focusPath)?.focus()
  }, [openPaths])

  if (openPaths.length === 0) return null

  const focusTab = (index: number): void => {
    const wrappedIndex = (index + openPaths.length) % openPaths.length
    const path = openPaths[wrappedIndex]?.path
    if (path) tabRefs.current.get(path)?.focus()
  }

  const handleClose = async (path: string, index: number): Promise<void> => {
    const neighbor = openPaths[index - 1] ?? openPaths[index + 1]
    const contentTarget = tabListRef.current?.closest<HTMLElement>('[data-content-focus-target]') ?? null
    focusAfterClose.current = { closingPath: path, focusPath: neighbor?.path ?? null, contentTarget }
    const closed = await closeTab(path)
    if (!closed) {
      if (focusAfterClose.current?.closingPath === path) focusAfterClose.current = null
      return
    }

    if (useWorkspaceTabsStore.getState().open_paths.some((item) => item.path === path)) {
      if (focusAfterClose.current?.closingPath === path) focusAfterClose.current = null
      return
    }
    if (neighbor) tabRefs.current.get(neighbor.path)?.focus()
    else contentTarget?.focus()
    if (focusAfterClose.current?.closingPath === path) focusAfterClose.current = null
  }

  return (
    <div ref={tabListRef} className="plan-tabs" role="tablist" aria-label={t('workspaceTabs.listLabel')} aria-orientation="horizontal">
      {openPaths.map((item, index) => {
        const name = planName(item.path)
        const selected = item.path === activePath

        return (
          <div className={`plan-tabs__item${selected ? ' plan-tabs__item--active' : ''}`} key={item.path} role="presentation">
            <button
              ref={(element) => {
                if (element) tabRefs.current.set(item.path, element)
                else tabRefs.current.delete(item.path)
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={t('workspaceTabs.activate', { name })}
              tabIndex={selected || (selectedIndex < 0 && index === 0) ? 0 : -1}
              className="plan-tabs__select"
              onClick={() => { void activate(item.path) }}
              onKeyDown={(event) => {
                switch (event.key) {
                  case 'ArrowLeft':
                    event.preventDefault()
                    focusTab(index - 1)
                    break
                  case 'ArrowRight':
                    event.preventDefault()
                    focusTab(index + 1)
                    break
                  case 'Home':
                    event.preventDefault()
                    focusTab(0)
                    break
                  case 'End':
                    event.preventDefault()
                    focusTab(openPaths.length - 1)
                    break
                }
              }}
            >
              <span className="plan-tabs__name">{name}</span>
            </button>
            <button
              type="button"
              className="plan-tabs__close"
              aria-label={t('workspaceTabs.close', { name })}
              title={t('workspaceTabs.close', { name })}
              onClick={(event) => {
                event.stopPropagation()
                void handleClose(item.path, index)
              }}
            >
              <CloseOutlined aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

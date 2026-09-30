import { useRef } from 'react'
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = openPaths.findIndex((item) => item.path === activePath)

  if (openPaths.length === 0) return null

  const focusTab = (index: number): void => {
    const wrappedIndex = (index + openPaths.length) % openPaths.length
    tabRefs.current[wrappedIndex]?.focus()
  }

  return (
    <div className="plan-tabs" role="tablist" aria-label={t('workspaceTabs.listLabel')} aria-orientation="horizontal">
      {openPaths.map((item, index) => {
        const name = planName(item.path)
        const selected = item.path === activePath

        return (
          <div className={`plan-tabs__item${selected ? ' plan-tabs__item--active' : ''}`} key={item.path} role="presentation">
            <button
              ref={(element) => { tabRefs.current[index] = element }}
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
                void closeTab(item.path)
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

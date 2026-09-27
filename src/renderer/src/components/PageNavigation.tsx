import type { ViewName } from '../stores/ui-store'

interface PageNavigationProps {
  currentView: ViewName
  onNavigate: (view: ViewName) => void
  labels: Readonly<Record<ViewName, string>>
  ariaLabel: string
}

const pageViews: readonly ViewName[] = ['workspace', 'diary', 'memories']

export default function PageNavigation({ currentView, onNavigate, labels, ariaLabel }: PageNavigationProps): React.JSX.Element {
  return (
    <nav className="view-nav" aria-label={ariaLabel}>
      {pageViews.map((view) => {
        const isCurrent = currentView === view

        return (
          <button
            key={view}
            type="button"
            className={`nav-btn${isCurrent ? ' active' : ''}`}
            aria-current={isCurrent ? 'page' : undefined}
            onClick={() => onNavigate(view)}
          >
            {labels[view]}
          </button>
        )
      })}
    </nav>
  )
}

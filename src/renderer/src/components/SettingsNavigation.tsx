import type { ReactNode } from 'react'
import { Button } from 'antd'

export type SettingsSectionId = 'general' | 'library' | 'templates' | 'workflows' | 'xiaoyuan' | 'about'

export interface SettingsNavigationItem {
  id: SettingsSectionId
  label: string
  icon: ReactNode
}

interface SettingsNavigationProps {
  activeSection: SettingsSectionId
  label: string
  sections: readonly SettingsNavigationItem[]
  onSelect: (section: SettingsSectionId) => void
}

export default function SettingsNavigation({ activeSection, label, sections, onSelect }: SettingsNavigationProps): React.JSX.Element {
  return (
    <nav className="trace-settings-nav" aria-label={label}>
      <div className="trace-settings-nav-list">
        {sections.map((section) => {
          const active = activeSection === section.id
          return (
            <Button
              key={section.id}
              type="text"
              className={`trace-settings-nav-item${active ? ' is-active' : ''}`}
              id={`trace-settings-nav-${section.id}`}
              aria-current={active ? 'page' : undefined}
              aria-controls={`trace-settings-panel-${section.id}`}
              onClick={() => onSelect(section.id)}
            >
              <span className="trace-settings-nav-icon" aria-hidden="true">{section.icon}</span>
              <span className="trace-settings-nav-label">{section.label}</span>
            </Button>
          )
        })}
      </div>
    </nav>
  )
}

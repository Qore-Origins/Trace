import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ActionIntent = 'primary' | 'secondary' | 'quiet' | 'danger' | 'icon'
export interface ActionButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  intent: ActionIntent
  label: string
  icon?: ReactNode
  loading?: boolean
  danger?: boolean
}
export function ActionButton({ intent, label, icon, loading = false, danger = false, disabled, className = '', ...props }: ActionButtonProps): React.JSX.Element {
  return (
    <button {...props} type="button" className={`trace-action trace-action--${intent}${danger ? ' trace-action--danger' : ''} ${className}`}
      disabled={disabled || loading} aria-busy={loading || undefined}
      aria-label={intent === 'icon' ? label : props['aria-label']} title={props.title ?? (intent === 'icon' ? label : undefined)}>
      {icon && <span aria-hidden="true" className="trace-action__icon">{icon}</span>}
      {intent !== 'icon' && label}
    </button>
  )
}

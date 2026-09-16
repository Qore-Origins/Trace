import type { ReactNode } from 'react'
import StatusBar from './StatusBar'
import TopBar from './TopBar'

interface AppShellProps {
  children: ReactNode
  showStatus?: boolean
  className?: string
}

export default function AppShell({ children, showStatus = false, className }: AppShellProps): React.JSX.Element {
  const classes = ['app-shell', className].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <TopBar />
      <div className="app-shell-main">{children}</div>
      {showStatus && <StatusBar />}
    </div>
  )
}

// 自绘窗口控制按钮（无边框模式）：最小化/最大化还原/关闭
// 样式贴近 Windows 11 惯例：46px 方形热区、悬停浅灰、关闭悬停红
import { useEffect } from 'react'
import { useAppStore } from '../stores/app-store'
import { invoke } from '../ipc-client'

function WinIcon({ kind }: { kind: 'min' | 'max' | 'restore' | 'close' }): React.JSX.Element {
  const s = { width: 10, height: 10, display: 'block' } as const
  const sw = 1
  if (kind === 'min')
    return (
      <svg style={s} viewBox="0 0 10 10">
        <path d="M0 5 H10" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  if (kind === 'max')
    return (
      <svg style={s} viewBox="0 0 10 10">
        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  if (kind === 'restore')
    return (
      <svg style={s} viewBox="0 0 10 10">
        <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth={sw} />
        <path d="M2.5 2.5 V0.5 H9.5 V7.5 H7.5" fill="none" stroke="currentColor" strokeWidth={sw} />
      </svg>
    )
  return (
    <svg style={s} viewBox="0 0 10 10">
      <path d="M0 0 L10 10 M10 0 L0 10" stroke="currentColor" strokeWidth={sw} />
    </svg>
  )
}

export default function WindowControls(): React.JSX.Element {
  const maximized = useAppStore((s) => s.winMaximized)
  // 初始状态对齐（首帧）
  useEffect(() => {
    void invoke('window:getMaximized')
      .then((r) => useAppStore.setState({ winMaximized: r.maximized }))
      .catch(() => undefined)
  }, [])

  const btn = (kind: 'min' | 'max' | 'close', onClick: () => void, label: string): React.JSX.Element => (
    <button type="button" className={`win-btn ${kind === 'close' ? 'win-close' : ''}`} aria-label={label} onClick={onClick}>
      <WinIcon kind={kind === 'max' && maximized ? 'restore' : kind} />
    </button>
  )

  return (
    <div className="win-controls">
      {btn('min', () => void invoke('window:minimize').catch(() => undefined), '最小化')}
      {btn('max', () => void invoke('window:toggleMaximize').catch(() => undefined), maximized ? '还原' : '最大化')}
      {btn('close', () => void invoke('window:close').catch(() => undefined), '关闭')}
    </div>
  )
}

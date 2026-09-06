// 自绘窗口控制按钮（无边框模式）：最小化/最大化还原/关闭
// 图标用 @ant-design/icons（与全应用图标同源；2026-09-06 用户反馈风格统一）；交互保持 Windows 惯例（方形热区/关闭悬停红）
import { useEffect } from 'react'
import { BorderOutlined, CloseOutlined, LineOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app-store'
import { invoke } from '../ipc-client'

export default function WindowControls(): React.JSX.Element {
  const maximized = useAppStore((s) => s.winMaximized)
  // 初始状态对齐（首帧）
  useEffect(() => {
    void invoke('window:getMaximized')
      .then((r) => useAppStore.setState({ winMaximized: r.maximized }))
      .catch(() => undefined)
  }, [])

  const btn = (icon: React.ReactNode, onClick: () => void, label: string, extraClass = ''): React.JSX.Element => (
    <button type="button" className={`win-btn ${extraClass}`} aria-label={label} title={label} onClick={onClick}>
      {icon}
    </button>
  )

  return (
    <div className="win-controls">
      {btn(<LineOutlined style={{ fontSize: 12 }} />, () => void invoke('window:minimize').catch(() => undefined), '最小化')}
      {btn(
        <BorderOutlined style={{ fontSize: 12 }} />,
        () => void invoke('window:toggleMaximize').catch(() => undefined),
        maximized ? '还原' : '最大化'
      )}
      {btn(<CloseOutlined style={{ fontSize: 12 }} />, () => void invoke('window:close').catch(() => undefined), '关闭', 'win-close')}
    </div>
  )
}

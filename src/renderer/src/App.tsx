import { Typography } from 'antd'

// Sprint 0 占位壳：验证 渲染器(React+antd) ↔ preload bridge 通路
// TODO(SPRINT-2): 替换为 主界面（计划树/内容区/顶栏/状态栏，见 UI 规范 §7.2 与原型 P-001）
export default function App(): React.JSX.Element {
  return (
    <div style={{ padding: 48 }}>
      <Typography.Title level={2}>溯源 Trace</Typography.Title>
      <Typography.Paragraph type="secondary">
        计划有迹可循 · 工程骨架就绪（Sprint 0） · 运行平台 {window.trace?.platform ?? 'unknown'}
      </Typography.Paragraph>
    </div>
  )
}

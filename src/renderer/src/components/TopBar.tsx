// TopBar（§2.2）：无边框标题栏——品牌 / 全局搜索（Sprint 3）/ 导入导出 / 自绘窗口控制
// 入口收敛（2026-09-06）：创建类操作只保留树底部，TopBar 只放全局动作
import { Dropdown, Input, Tooltip, message } from 'antd'
import { SwapOutlined } from '@ant-design/icons'
import { useTreeStore } from '../stores/tree-store'
import WindowControls from './WindowControls'
import { ClientError } from '../ipc-client'

export default function TopBar(): React.JSX.Element {
  return (
    <div className="ws-top">
      <div className="brand">
        <span className="brand-dot" />
        溯源 Trace
      </div>
      <div className="search">
        <Tooltip title="溯源检索将在 Sprint 3 接入索引服务">
          <Input placeholder="搜索：沿迹回望计划 / 任务 / 注释…" readOnly />
        </Tooltip>
      </div>
      <div className="spacer" />
      <TransferMenu />
      <WindowControls />
    </div>
  )
}

// ---------- 导入/导出菜单（.plan 互通 + Markdown 旧计划迁入） ----------
function TransferMenu(): React.JSX.Element {
  const { exportPlan, importPlan, importMarkdown, selectedPath } = useTreeStore()
  const run = async (action: () => Promise<string | null>): Promise<void> => {
    try {
      const msg = await action()
      if (msg) message.success(msg, 5)
    } catch (e) {
      message.error(e instanceof ClientError ? e.message : '操作失败', 5)
    }
  }

  return (
    <Dropdown
      menu={{
        items: [
          {
            key: 'export',
            label: '导出当前计划 (.plan)',
            disabled: !selectedPath,
            onClick: () => selectedPath && void run(() => exportPlan(selectedPath))
          },
          { type: 'divider' },
          { key: 'import-plan', label: '导入 .plan（到选中计划/顶层）', onClick: () => void run(() => importPlan(selectedPath ?? '')) },
          { key: 'import-md', label: '迁入 Markdown 计划…', onClick: () => void run(() => importMarkdown(selectedPath ?? '')) }
        ]
      }}
    >
      <button type="button" className="ant-btn ant-btn-default" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <SwapOutlined /> 导入 / 导出
      </button>
    </Dropdown>
  )
}

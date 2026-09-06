// TopBar（§2.2）：无边框标题栏——品牌 / 全局搜索（Sprint 3）/ 导入导出 / 新建计划 / 自绘窗口控制
// 拖拽区 = 标题栏整体（-webkit-app-region: drag），交互控件 no-drag
import { useEffect, useState } from 'react'
import { Button, Dropdown, Input, Modal, Tooltip, message } from 'antd'
import { PlusOutlined, SwapOutlined } from '@ant-design/icons'
import { useTreeStore } from '../stores/tree-store'
import { usePlanStore } from '../stores/plan-store'
import WindowControls from './WindowControls'
import { ClientError } from '../ipc-client'

export default function TopBar(): React.JSX.Element {
  const createPlan = useTreeStore((s) => s.createPlan)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const submit = async (): Promise<void> => {
    if (!name.trim()) return
    try {
      await createPlan('', name.trim())
      setOpen(false)
      setName('')
    } catch {
      message.error('创建失败（同名/非法字符?）')
    }
  }

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
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        新建计划
      </Button>
      <WindowControls />
      <Modal
        title="新建顶层计划"
        open={open}
        onOk={() => void submit()}
        onCancel={() => setOpen(false)}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Input
          placeholder="计划名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onPressEnter={() => void submit()}
          autoFocus
        />
      </Modal>
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
      <Button icon={<SwapOutlined />}>导入 / 导出</Button>
    </Dropdown>
  )
}

// TopBar（§2.2）：品牌 / 全局搜索（Sprint 3 解锁）/ 新建计划
import { useState } from 'react'
import { Button, Input, Modal, Tooltip, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useTreeStore } from '../stores/tree-store'

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
      <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
        新建计划
      </Button>
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

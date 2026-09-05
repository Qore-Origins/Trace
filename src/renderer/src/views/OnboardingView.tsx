// 首启引导（§3.7）：品牌陈述=数据承诺；无注册无网络
import { useState } from 'react'
import { Button, Typography } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app-store'
import { invoke } from '../ipc-client'

export default function OnboardingView(): React.JSX.Element {
  const setRootDir = useAppStore((s) => s.setRootDir)
  const [chosen, setChosen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const choose = async (): Promise<void> => {
    const r = await invoke('app:chooseDirectory')
    if (r.dirPath) setChosen(r.dirPath)
  }

  const confirm = async (): Promise<void> => {
    if (!chosen) return
    setBusy(true)
    try {
      // 首次配置 confirmed=false 即可（仅切换已有根目录时需要确认）
      await setRootDir(chosen, false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboard">
      <div className="onboard-inner">
        <div className="logo-dot" />
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          溯源 <em style={{ fontStyle: 'normal', color: 'var(--trace-500)' }}>Trace</em>
        </Typography.Title>
        <div className="slogan">计划有迹可循</div>
        <div className="desc">
          你的计划将以<b>普通文件夹</b>保存在你选择的位置——任何时刻可整体拷贝备份、迁移到新电脑，数据
          <b>不出你的设备</b>。
        </div>
        <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => void choose()}>
          选择计划库目录
        </Button>
        {chosen && (
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--success)' }}>✓</span> 已选：<span>{chosen}</span>
            <div style={{ marginTop: 12 }}>
              <Button type="primary" loading={busy} onClick={() => void confirm()}>
                进入溯源
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// 首启引导（§3.7）：品牌陈述=数据承诺；无注册无网络
import { useState } from 'react'
import { Alert, Button, Typography, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app-store'
import { invoke, ClientError } from '../ipc-client'

export default function OnboardingView(): React.JSX.Element {
  const { setRootDir, rootDir: prevRoot, rootInvalid } = useAppStore()
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
      // 引导页只在「未配置」或「旧根目录失效」时出现——两者均无需切换确认（主进程同语义）
      await setRootDir(chosen, false)
    } catch (e) {
      message.error(e instanceof ClientError ? e.message : '设置失败，请重试')
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
        {rootInvalid && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16, textAlign: 'left' }}
            message="原计划库位置不可用"
            description={`之前配置的目录（${prevRoot ?? '-'}）已无法访问。重新选择一个位置即可；原数据不会被动删除。`}
          />
        )}
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

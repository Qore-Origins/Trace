// 首启引导（§3.7）：品牌陈述=数据承诺；无注册无网络
import { useState } from 'react'
import { Alert, Button, Typography, message } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useAppStore } from '../stores/app-store'
import { invoke, ClientError } from '../ipc-client'
import WindowControls from '../components/WindowControls'
import { useTranslation } from '../i18n'

export default function OnboardingView(): React.JSX.Element {
  const { t } = useTranslation()
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
      message.error(e instanceof ClientError ? e.message : t('errors.setFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="onboard">
      {/* 无边框：引导页也需要拖拽区与窗口控制 */}
      <div className="onboard-titlebar">
        <span className="brand">
          <span className="brand-dot" />
          溯源 Trace
        </span>
        <WindowControls />
      </div>
      <div className="onboard-inner">
        <div className="logo-dot" />
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          溯源 <em style={{ fontStyle: 'normal', color: 'var(--trace-500)' }}>Trace</em>
        </Typography.Title>
        <div className="slogan">{t('brand.slogan')}</div>
        {rootInvalid && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16, textAlign: 'left' }}
            message={t('onboard.rootUnavailable')}
            description={t('onboard.rootUnavailableDesc', { dir: prevRoot ?? '-' })}
          />
        )}
        <div className="desc">
          {t('onboard.descPrefix')}
          <b>{t('onboard.plainFolder')}</b>
          {t('onboard.descMiddle')}
          <b>{t('onboard.notLeaveDevice')}</b>。
        </div>
        <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => void choose()}>
          {t('onboard.chooseDir')}
        </Button>
        {chosen && (
          <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-2)' }}>
            <span style={{ color: 'var(--success)' }}>✓</span> {t('onboard.chosen')}
            <span>{chosen}</span>
            <div style={{ marginTop: 12 }}>
              <Button type="primary" loading={busy} onClick={() => void confirm()}>
                {t('onboard.enter')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

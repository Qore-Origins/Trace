import { useEffect, useState } from 'react'
import type { AgentApprovalRequestSnapshot } from '@shared/agent-types'
import './agent-approval.css'

export function AgentApprovalWindow(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AgentApprovalRequestSnapshot | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'sending'>('loading')

  useEffect(() => {
    let mounted = true
    const bridge = window.traceAgentApproval
    if (!bridge) {
      setStatus('unavailable')
      return () => { mounted = false }
    }
    void bridge.getSnapshot().then((value) => {
      if (!mounted) return
      if (!value) {
        setStatus('unavailable')
        return
      }
      setSnapshot(value)
      setStatus('ready')
    }).catch(() => {
      if (mounted) setStatus('unavailable')
    })
    return () => { mounted = false }
  }, [])

  const decide = async (approved: boolean): Promise<void> => {
    const bridge = window.traceAgentApproval
    if (!bridge || status !== 'ready') return
    setStatus(approved ? 'sending' : 'unavailable')
    try {
      if (approved) await bridge.confirm()
      else await bridge.cancel()
    } catch {
      setStatus('unavailable')
    }
  }

  return (
    <main className="agent-approval">
      <header>
        <h1>确认外发内容</h1>
        <p>请核对本次将发送的确切请求。只有点击“允许发送”后，Trace 才会连接模型服务。</p>
      </header>
      {status === 'loading' && <p role="status">正在载入请求预览…</p>}
      {status === 'unavailable' && <p role="alert">请求预览已失效或确认窗口异常关闭。没有发送请求，请返回 Trace 后重新操作。</p>}
      {status === 'sending' && <p role="status">已确认，正在开始请求…</p>}
      {snapshot && (
        <>
          <dl className="agent-approval__target">
            <div><dt>服务地址</dt><dd data-agent-approval-endpoint>{snapshot.endpoint}</dd></div>
            <div><dt>模型</dt><dd data-agent-approval-model>{snapshot.model}</dd></div>
          </dl>
          <section aria-labelledby="agent-approval-body-title">
            <h2 id="agent-approval-body-title">完整请求正文</h2>
            <pre data-agent-approval-body>{snapshot.serializedBody}</pre>
          </section>
          <footer>
            <button type="button" disabled={status !== 'ready'} onClick={() => { void decide(false) }}>取消</button>
            <button type="button" disabled={status !== 'ready'} onClick={() => { void decide(true) }}>允许发送</button>
          </footer>
        </>
      )}
    </main>
  )
}

// ExportView：「导出为」离屏窗口的渲染视图（?export=1&path=…）——只渲染计划卡内容，
// 无顶栏/树/交互底座；渲染完成后置 window.__EXPORT_READY__（main 侧轮询该标志）
// 恒亮色纸面（打印/分享语义）：main.tsx ThemeGate 对导出模式不挂 theme-dark
import { useEffect, useState } from 'react'
import { invoke } from '../ipc-client'
import { ComponentRenderer } from '../components/cards'
import type { PlanDocument, Component } from '@shared/plan-types'

declare global {
  interface Window {
    __EXPORT_READY__?: boolean
  }
}

export default function ExportView({ path }: { path: string }): React.JSX.Element {
  const [doc, setDoc] = useState<PlanDocument | null>(null)

  useEffect(() => {
    let alive = true
    void invoke('storage:readPlan', { path })
      .then((d: PlanDocument) => {
        if (!alive) return
        setDoc(d)
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [path])

  // 渲染完成信号：双 rAF 确保本轮绘制提交后置位（main 轮询消费）
  useEffect(() => {
    if (!doc) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        window.__EXPORT_READY__ = true
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [doc])

  const today = new Date()
  return (
    <div className="export-root" style={{ width: 794, background: 'var(--paper)', padding: 32, boxSizing: 'border-box' }}>
      {doc ? <ComponentRenderer components={doc.components as Component[]} today={today} /> : null}
    </div>
  )
}

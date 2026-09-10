// TreeResizer：树侧边栏拖拽调宽（VS Code 参考行为：跟手拖拽 + 上下限约束 + 释放时持久化）
// 性能：拖拽中直接改目标元素 DOM 宽度（不触发 React 重渲染——大树每帧 setState 会很重）；
// pointerup 才写 pref-store（React 下次渲染 style 差值为新值，无回跳）。
// setPointerCapture 保证指针移出元素仍收 move/up；pointercancel 一并收尾（中断清理）。
import { useCallback, useRef } from 'react'
import { usePrefStore, clampTreeWidth } from '../stores/pref-store'
import { useTranslation } from '../i18n'

export default function TreeResizer({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const { t } = useTranslation()
  const setTreeWidth = usePrefStore((s) => s.setTreeWidth)
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = targetRef.current
      if (!el) return
      e.preventDefault() // 防拖拽选中文本
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { startX: e.clientX, startW: el.getBoundingClientRect().width }
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [targetRef]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      const el = targetRef.current
      if (!d || !el) return
      el.style.width = `${clampTreeWidth(d.startW + (e.clientX - d.startX))}px`
    },
    [targetRef]
  )

  const onPointerEnd = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      drag.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      const el = targetRef.current
      if (!d || !el) return
      // 宽度写回 store（实际渲染宽度为准——clamp 已在途中应用）
      const w = el.getBoundingClientRect().width
      setTreeWidth(w)
      el.style.width = `${clampTreeWidth(w)}px` // store 渲染前兜正（防浮点/亚像素）
    },
    [targetRef, setTreeWidth]
  )

  return (
    <div
      className="tree-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('tree.resize')}
      title={t('tree.resize')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    />
  )
}

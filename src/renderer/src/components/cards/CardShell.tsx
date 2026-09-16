import type React from 'react'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, HolderOutlined } from '@ant-design/icons'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Component } from '@shared/plan-types'
import { getMessage } from '../../antd-host'
import { useTranslation } from '../../i18n'
import { usePlanMutations, usePlanStore } from '../../stores/plan-store'
import { ActionButton } from '../ui/ActionButton'
import { confirmAction } from '../ui/ConfirmAction'
import { focusNearestCard } from '../ui/plan-row-actions'

export interface CardRenderProps {
  comp: Component
  index: number
  total: number
  today: Date
}

export function CardShell(props: {
  kind: string
  componentId: string
  index: number
  total: number
  extraClass?: string
  head?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  const kindLabel =
    props.kind === 'single_plan'
      ? t('cards.kindSinglePlan')
      : props.kind === 'multi_plan'
        ? t('cards.kindMultiPlan')
        : props.kind === 'task_list'
          ? t('cards.kindTaskList')
          : props.kind === 'task_detail'
            ? t('cards.kindTaskDetail')
            : props.kind === 'mood'
              ? t('cards.moodLabel')
              : props.kind === 'heading'
                ? t('content.insertHeading')
                : t('cards.kindNote')
  const { moveComponent, removeComponent } = usePlanMutations()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.componentId })
  // 剥掉 scale 分量（仅保留位移补偿）：dnd-kit useDerivedTransform 在 index 切换时会给出
  // 初始/当前矩形的比例（scaleX/scaleY），卡片高度不一时被拖卡被拉伸成目标卡形状
  // （用户报告"继承目标卡宽高"，CDP 实证 transform matrix scaleY=2.34——2026-09-10）
  const tt = transform ? { x: transform.x, y: transform.y, scaleX: 1, scaleY: 1 } : null
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(tt), transition }}
      className={`card ${props.extraClass ?? ''}${isDragging ? ' dragging' : ''}`}
      data-component-id={props.componentId}
      tabIndex={-1}
    >
      <div className="kind">
        <span className="drag-handle" aria-label={t('cards.dragSort')} title={t('cards.dragSortTitle')} {...attributes} {...listeners}>
          <HolderOutlined />
        </span>
        {kindLabel}
      </div>
      {props.head}
      {props.children}
      <div className="actions">
        <ActionButton intent="icon" label={t('cards.moveUp')} icon={<ArrowUpOutlined />}
          onClick={() => moveComponent(props.componentId, props.index - 1)}
          style={{ visibility: props.index > 0 ? 'visible' : 'hidden' }}
        />
        <ActionButton intent="icon" label={t('cards.moveDown')} icon={<ArrowDownOutlined />}
          onClick={() => moveComponent(props.componentId, props.index + 1)}
          style={{ visibility: props.index < props.total - 1 ? 'visible' : 'hidden' }}
        />
        <ActionButton intent="icon" danger label={t('cards.remove')} icon={<DeleteOutlined />} onClick={() => {
          const opened = usePlanStore.getState()
          confirmAction({
            title: t('actions.deleteComponentTitle', { name: kindLabel }), description: t('actions.deleteComponentDesc'),
            onConfirm: () => {
              const current = usePlanStore.getState()
              if (current.currentPath !== opened.currentPath || current.document !== opened.document) {
                getMessage().warning(t('actions.staleConfirmation'))
                return
              }
              removeComponent(props.componentId)
            }, afterConfirm: () => focusNearestCard(props.index)
          })
        }} />
      </div>
    </div>
  )
}

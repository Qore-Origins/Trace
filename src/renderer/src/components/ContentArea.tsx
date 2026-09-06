// ContentArea（§2.2）：面包屑 + 组件序列 + 空态 + 外部变更提示 + 插入组件；文件夹=容器视图
import { useEffect, useMemo } from 'react'
import { Alert, Button, Dropdown, Empty, message } from 'antd'
import { FolderOutlined, PlusOutlined, ReadOutlined } from '@ant-design/icons'
import { usePlanStore, usePlanMutations } from '../stores/plan-store'
import { useTreeStore } from '../stores/tree-store'
import { ComponentRenderer } from './cards'
import { uuid32 } from '@shared/validation'
import type { Component, ComponentType } from '@shared/plan-types'

function newComponent(type: ComponentType): Component {
  const now = new Date().toISOString()
  const id = uuid32()
  switch (type) {
    case 'single_plan':
      return { id, type, payload: { title: '', done: false, created_at: now } }
    case 'multi_plan':
      return { id, type, payload: { title: '', options: [{ id: uuid32(), text: '', checked: false }] } }
    case 'task_list':
      return { id, type, payload: { title: '', items: [] } }
    case 'task_detail':
      return { id, type, payload: { title: '', status: 'not_started', created_at: now } }
    case 'note':
      return { id, type, payload: { content: '', created_at: now } }
  }
}

const INSERT_ITEMS: Array<{ key: ComponentType; label: string }> = [
  { key: 'single_plan', label: '单选计划' },
  { key: 'multi_plan', label: '多选计划' },
  { key: 'task_list', label: '任务列表' },
  { key: 'task_detail', label: '任务详情' },
  { key: 'note', label: '注释' }
]

export default function ContentArea(): React.JSX.Element {
  const { currentPath, document: doc, externalAlert, open } = usePlanStore()
  const { appendComponent } = usePlanMutations()
  const { selectedKind, childrenMap, loadChildren } = useTreeStore()
  const today = useMemo(() => new Date(), [doc?.updated_at])

  // 文件夹容器视图：列出子项，点击进入
  useEffect(() => {
    if (currentPath && selectedKind === 'folder') void loadChildren(currentPath).catch(() => undefined)
  }, [currentPath, selectedKind, loadChildren])

  if (!currentPath) {
    return (
      <div className="ws-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="从左侧选择一个计划，开始你的迹线" />
      </div>
    )
  }

  const segments = currentPath.split('/')

  if (selectedKind === 'folder') {
    // 纯容器文件夹：内容区显示子项列表
    const children = childrenMap[currentPath] ?? []
    return (
      <div className="ws-content">
        <div className="crumbs">
          <span className="origin-dot" />
          <span>源头</span>
          {segments.map((seg, i) => (
            <span key={i} style={{ display: 'flex', gap: 6 }}>
              <span style={{ color: 'var(--text-4)' }}>›</span>
              {i === segments.length - 1 ? <span className="here">{seg}</span> : <span>{seg}</span>}
            </span>
          ))}
        </div>
        <Empty
          image={<FolderOutlined style={{ fontSize: 42, color: 'var(--text-4)' }} />}
          description={children.length ? '此文件夹为容器——点击子项进入' : '空文件夹——把计划拖进来归类'}
        />
        <div className="folder-grid">
          {children.map((c) => (
            <div
              key={c.path}
              className="card folder-item"
              onClick={() => {
                if (c.kind === 'plan') {
                  useTreeStore.getState().select(c.path, 'plan')
                  void open(c.path)
                } else {
                  useTreeStore.getState().select(c.path, 'folder')
                }
              }}
            >
              {c.kind === 'folder' ? (
                <FolderOutlined style={{ color: 'var(--text-4)' }} />
              ) : (
                <ReadOutlined style={{ color: 'var(--trace-500)', opacity: 0.75 }} />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-4)', flex: 'none' }}>
                {c.kind === 'folder' ? '文件夹' : '计划'}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="ws-content">
      <div className="crumbs">
        <span className="origin-dot" />
        <span>源头</span>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--text-4)' }}>›</span>
            {i === segments.length - 1 ? <span className="here">{seg}</span> : <span>{seg}</span>}
          </span>
        ))}
      </div>

      {externalAlert && (
        <Alert
          type="warning"
          showIcon
          message="计划库在应用外被修改"
          description="检测到外部工具改动了计划库文件。"
          action={
            <Button size="small" onClick={() => currentPath && void open(currentPath)}>
              重新加载当前计划
            </Button>
          }
          closable
          style={{ marginBottom: 12 }}
        />
      )}

      {doc ? (
        <>
          <ComponentRenderer components={doc.components} today={today} />
          <Dropdown
            menu={{
              items: INSERT_ITEMS,
              onClick: ({ key }) => {
                appendComponent(newComponent(key as ComponentType))
                message.success(`已插入${INSERT_ITEMS.find((i) => i.key === key)?.label ?? '组件'}`)
              }
            }}
          >
            <Button type="dashed" block icon={<PlusOutlined />}>
              插入组件
            </Button>
          </Dropdown>
        </>
      ) : (
        <Empty description="载入中…" />
      )}
    </div>
  )
}

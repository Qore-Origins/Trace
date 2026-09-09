// ContentArea（§2.2）：面包屑 + 组件序列 + 空态 + 外部变更提示 + 插入组件；文件夹=容器视图
import { useEffect, useMemo } from 'react'
import { Alert, Button, Dropdown, Empty, message, type MenuProps } from 'antd'
import { CalendarOutlined, DeleteOutlined, FolderOutlined, PlusOutlined, ReadOutlined } from '@ant-design/icons'
import { usePlanStore, usePlanMutations } from '../stores/plan-store'
import { useTreeStore } from '../stores/tree-store'
import { useUiStore } from '../stores/ui-store'
import { usePrefStore, type CustomPreset } from '../stores/pref-store'
import { ComponentRenderer } from './cards'
import { uuid32 } from '@shared/validation'
import { ERR, TraceError } from '@shared/errors'
import { useTranslation } from '../i18n'
import type { Component, ComponentType, CustomPayload } from '@shared/plan-types'

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
    case 'mood':
      return { id, type, payload: { score: 50, text: '', mood_date: todayStr(), created_at: now } }
    case 'heading':
      return { id, type, payload: { title: '', size: 18 } }
    case 'custom':
      return { id, type, payload: { content: '' } }
    default:
      // 契约 8 类已全部有工厂 case，此分支不可达；fail-fast 守卫未来新增类型（而非静默造卡）
      throw new TraceError(ERR.INTERNAL, `未知组件类型：${type}`)
  }
}

// 本地日期 'YYYY-MM-DD'（due_date 存储格式；字符串比较即时间序）
function todayStr(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// Menu items 联合含 MenuDividerType（无 key/label），按 key 取 label 需窄化守卫
function itemLabel(items: NonNullable<MenuProps['items']>, key: string, fallback: string): string {
  const item = items.find((i) => i !== null && 'key' in i && i.key === key)
  if (item && 'label' in item && typeof item.label === 'string') return item.label
  return fallback
}

export default function ContentArea(): React.JSX.Element {
  const { t } = useTranslation()
  const { currentPath, document: doc, externalAlert, open, setDueDate } = usePlanStore()
  const { appendComponent } = usePlanMutations()
  const { selectedKind, childrenMap, loaded, loadChildren } = useTreeStore()
  const customPresets = usePrefStore((s) => s.customPresets)
  const removePreset = usePrefStore((s) => s.removePreset)
  const today = useMemo(() => new Date(), [doc?.updated_at])

  // 插入预设快照：复制 content 到新卡、source=预设名（改预设不影响已插入卡）
  const insertCustomWithPreset = (preset: CustomPreset): void => {
    const comp = newComponent('custom')
    ;(comp.payload as CustomPayload).content = preset.content
    ;(comp.payload as CustomPayload).source = preset.name
    appendComponent(comp)
    message.success(t('content.inserted', { label: preset.name }))
  }

  // 「自定义组件」为子菜单：新建 + 预设列表（antd Menu items 带 children 即子菜单形态）
  const insertItems: MenuProps['items'] = [
    { key: 'single_plan', label: t('cards.kindSinglePlan') },
    { key: 'multi_plan', label: t('cards.kindMultiPlan') },
    { key: 'task_list', label: t('cards.kindTaskList') },
    { key: 'task_detail', label: t('cards.kindTaskDetail') },
    { key: 'note', label: t('content.noteShort') },
    { key: 'mood', label: t('content.insertMood') },
    { key: 'heading', label: t('content.insertHeading') },
    {
      key: 'custom',
      label: t('content.insertCustom'),
      children: [
        { key: 'custom-new', label: t('content.customNew') },
        ...customPresets.map((p) => ({
          key: `custom-${p.id}`,
          label: (
            <span className="preset-item">
              <span className="preset-name">{p.name}</span>
              <button
                type="button"
                className="preset-del lite-btn danger"
                title={t('common.delete')}
                aria-label={`${t('common.delete')} ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation() // 防冒泡触发菜单条目 onClick（插入快照）
                  removePreset(p.id)
                }}
              >
                <DeleteOutlined />
              </button>
            </span>
          )
        }))
      ]
    }
  ]

  // 文件夹容器视图：列出子项，点击进入
  useEffect(() => {
    if (currentPath && selectedKind === 'folder') void loadChildren(currentPath).catch(() => undefined)
  }, [currentPath, selectedKind, loadChildren])

  if (!currentPath) {
    // 空库/未选中：给出可执行的下一步（空库时引导建计划或迁入 Markdown，而非沉默）
    const treeEmpty = (childrenMap[''] ?? []).length === 0 && loaded[''] === true
    return (
      <div className="ws-content" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description={treeEmpty ? t('content.emptyLibrary') : t('content.emptySelect')}>
          {treeEmpty && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <Button type="primary" onClick={() => useUiStore.getState().openNameDialog({ mode: 'create-plan', targetPath: '', initialName: '' })}>
                {t('content.createFirst')}
              </Button>
              <Button onClick={() => void useTreeStore.getState().importMarkdown('')}>{t('content.importMd')}</Button>
            </div>
          )}
        </Empty>
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
          <span>{t('content.origin')}</span>
          {segments.map((seg, i) => (
            <span key={i} style={{ display: 'flex', gap: 6 }}>
              <span style={{ color: 'var(--text-4)' }}>›</span>
              {i === segments.length - 1 ? <span className="here">{seg}</span> : <span>{seg}</span>}
            </span>
          ))}
        </div>
        <Empty
          image={<FolderOutlined style={{ fontSize: 42, color: 'var(--text-4)' }} />}
          description={children.length ? t('content.folderContainerHint') : t('content.emptyFolderHint')}
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
                {c.kind === 'folder' ? t('content.folderLabel') : t('content.planLabel')}
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
        <span>{t('content.origin')}</span>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: 'flex', gap: 6 }}>
            <span style={{ color: 'var(--text-4)' }}>›</span>
            {i === segments.length - 1 ? <span className="here">{seg}</span> : <span>{seg}</span>}
          </span>
        ))}
      </div>

      {doc && (
        <div className={`due-date${doc.due_date && doc.due_date < todayStr() ? ' overdue' : ''}`}>
          <span className="due-label">{t('content.dueDateLabel')}</span>
          {doc.due_date ? (
            <>
              <input
                type="date"
                className="due-input"
                value={doc.due_date}
                onChange={(e) => void setDueDate(e.target.value || undefined)}
              />
              <Button size="small" type="text" onClick={() => void setDueDate(undefined)}>
                {t('content.dueDateClear')}
              </Button>
              {doc.due_date < todayStr() && <span className="due-overdue">{t('content.dueDateOverdue')}</span>}
            </>
          ) : (
            <Button size="small" type="text" icon={<CalendarOutlined />} onClick={() => void setDueDate(todayStr())}>
              {t('content.dueDateAdd')}
            </Button>
          )}
        </div>
      )}

      {externalAlert && (
        <Alert
          type="warning"
          showIcon
          message={t('content.externalChanged')}
          description={t('content.externalChangedDesc')}
          action={
            <Button size="small" onClick={() => currentPath && void open(currentPath)}>
              {t('content.reloadCurrent')}
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
              items: insertItems,
              onClick: ({ key }) => {
                if (key === 'custom-new') {
                  appendComponent(newComponent('custom'))
                  message.success(t('content.inserted', { label: t('content.customNew') }))
                  return
                }
                if (key.startsWith('custom-')) {
                  const preset = customPresets.find((p) => `custom-${p.id}` === key)
                  if (preset) insertCustomWithPreset(preset)
                  return
                }
                appendComponent(newComponent(key as ComponentType))
                message.success(t('content.inserted', { label: itemLabel(insertItems, key, t('content.componentFallback')) }))
              }
            }}
          >
            <Button type="dashed" block icon={<PlusOutlined />}>
              {t('content.insertComponent')}
            </Button>
          </Dropdown>
        </>
      ) : (
        <Empty description={t('common.loading')} />
      )}
    </div>
  )
}

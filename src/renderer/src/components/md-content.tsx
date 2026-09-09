// MdContent：Markdown 双态内容区（NoteCard / CustomCard 共用）
// 有内容默认渲染（view，NoteMarkdown 子集含代码块）；空内容/切编辑进 textarea（edit）
// content 值受控：持久化由调用方 onChange 负责（校验 + patchComponent），本组件只切视图
import { useState } from 'react'
import { Button, Input } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useTranslation } from '../i18n'
import { NoteMarkdown } from './note-md'

function openLink(url: string): void {
  // 仅 http(s) 外链新窗口打开；相对/无协议链接拦截（防止 Electron 页面被内嵌导航跳走）
  if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
}

export function MdContent(props: {
  content: string
  onChange: (next: string) => void
  placeholder?: string
  allowEmpty?: boolean // 初始空内容=直接编辑态（NoteCard 用 true，CustomCard 用 false）
}): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(props.allowEmpty !== false && props.content.trim() === '')
  return editing ? (
    <>
      <Input.TextArea variant="borderless" placeholder={props.placeholder ?? t('cards.notePlaceholder')} autoSize
        value={props.content}
        onChange={(e) => props.onChange(e.target.value)} />
      <div className="note-actions">
        <Button size="small" type="text" onClick={() => setEditing(false)}>{t('cards.noteDone')}</Button>
        <span className="note-hint">{t('cards.noteMdHint')}</span>
      </div>
    </>
  ) : (
    <>
      <NoteMarkdown content={props.content} onLink={openLink} />
      <div className="note-actions note-actions-end">
        <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(true)}>{t('cards.noteEdit')}</Button>
      </div>
    </>
  )
}

// StatusBar（§3.8）：系统脉搏——索引/保存/根目录
import { useAppStore } from '../stores/app-store'
import { usePlanStore } from '../stores/plan-store'

function saveText(state: string, lastError: string | null): string {
  if (state === 'editing') return '编辑中…'
  if (state === 'saved') return '✓ 已保存'
  if (state === 'error') return `保存失败：${lastError ?? ''}`
  return '就绪'
}

export default function StatusBar(): React.JSX.Element {
  const indexState = useAppStore((s) => s.indexState)
  const rootDir = useAppStore((s) => s.rootDir)
  const saveState = usePlanStore((s) => s.saveState)
  const lastError = usePlanStore((s) => s.lastError)

  return (
    <div className="ws-status">
      <span>
        <span className={`dot-ok ${indexState === 'building' ? 'dot-building' : ''} ${indexState === 'error' ? 'dot-error' : ''}`} />
        {indexState === 'building' ? '索引构建中' : indexState === 'error' ? '索引异常' : '索引就绪'}
      </span>
      <span className={saveState === 'saved' ? 'status-saved' : ''}>{saveText(saveState, lastError)}</span>
      <span style={{ flex: 1 }} />
      <span>根目录 {rootDir ?? '-'}</span>
    </div>
  )
}

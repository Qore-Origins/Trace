import { Input, InputNumber } from 'antd'
import type { MoodPayload } from '@shared/plan-types'
import { todayDateStr, validateNoteText, validateScore } from '@shared/validation'
import { useTranslation } from '../../i18n'
import { usePlanMutations } from '../../stores/plan-store'
import { usePrefStore } from '../../stores/pref-store'
import { MoodScoreRoll } from '../mood-score-roll'
import { CardShell, type CardRenderProps } from './CardShell'

// 心情色阶：≤30 冷灰蓝 → ≥80 暖橙（线性）
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 30) / 50))
  const from = [96, 130, 182] // 冷
  const to = [255, 122, 69] // 暖
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t))
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`
}

// 信息数字保留连续冷暖变化，同时混入主题正文色；装饰仍消费原色阶。
export function scoreTextColor(score: number): string {
  const scoreColorPercent = 50
  return `color-mix(in srgb, ${scoreColor(score)} ${scoreColorPercent}%, var(--text-1))`
}

export function MoodCard({ comp, index, total }: CardRenderProps): React.JSX.Element {
  const { t } = useTranslation()
  const { patchComponent } = usePlanMutations()
  const scoreAnim = usePrefStore((s) => s.scoreAnim)
  const p = comp.payload as MoodPayload
  return (
    <CardShell kind="mood" componentId={comp.id} index={index} total={total} extraClass="mood">
      <div className="mood-row">
        <div className="mood-score" style={{ color: scoreTextColor(p.score) }}>
          {scoreAnim === 'roll' ? <MoodScoreRoll value={p.score} /> : p.score}
        </div>
        <InputNumber
          min={0} max={100} step={1} precision={2}
          className="mood-input"
          value={p.score}
          onChange={(v) => {
            try {
              patchComponent(comp.id, (payload) => { (payload as MoodPayload).score = validateScore(v) })
            } catch {
              // 非法输入静默拒绝（不改 store）
            }
          }}
        />
      </div>
      <Input.TextArea variant="borderless" autoSize placeholder={t('cards.moodPlaceholder')}
        value={p.text}
        onChange={(e) => { validateNoteText(e.target.value, t('cards.moodLabel')); patchComponent(comp.id, (pl) => { (pl as MoodPayload).text = e.target.value }) }} />
      <div className="mood-meta">
        <input type="date" className="mood-date" value={p.mood_date}
          onChange={(e) => {
            // 清空=回退今天（mood_date 契约必填；空值 guard 导致受控回弹——2026-09-09 ledger 此项）
            const next = e.target.value || todayDateStr()
            patchComponent(comp.id, (pl) => { (pl as MoodPayload).mood_date = next })
          }} />
        <span>{p.created_at.slice(0, 10)}</span>
      </div>
    </CardShell>
  )
}

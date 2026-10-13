import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from 'antd'
import type { PlanDocument, TaskListPayload } from '@shared/plan-types'
import type { WorkflowHandoffPreview, WorkflowHandoffTask } from '@shared/plan-workflow-types'
import { invoke, onEvent } from '../ipc-client'
import { useTranslation } from '../i18n'
import { useWorkspaceTabsStore } from '../stores/workspace-tabs-store'

interface DaySummary {
  date: string
  planId: string | null
  status: 'found' | 'missing' | 'conflict'
  path?: string
  taskCount: number
  doneCount: number
}

interface Props {
  document: PlanDocument
  libraryId: string
}

export default function WeekPlanOverview({ document, libraryId }: Props): React.JSX.Element | null {
  const { t } = useTranslation()
  const workflow = document.workflow
  const generationRef = useRef(0)
  const [days, setDays] = useState<DaySummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [handoff, setHandoff] = useState<WorkflowHandoffPreview | null>(null)
  const [handoffError, setHandoffError] = useState<string | null>(null)
  const [handoffTargets, setHandoffTargets] = useState<Record<string, string>>({})
  const [movingTask, setMovingTask] = useState<string | null>(null)
  const entries = useMemo(() => workflow?.kind === 'week'
    ? Object.entries(workflow.day_plan_ids).sort(([left], [right]) => left.localeCompare(right)) : [],
  // The week plan's own CAS revision changes whenever the day mapping changes.
  [document.updated_at, workflow])

  useEffect(() => {
    if (workflow?.kind !== 'week') return
    let active = true
    const generation = ++generationRef.current
    const load = async (): Promise<void> => {
      if (!active || useWorkspaceTabsStore.getState().library_id !== libraryId) return
      setLoading(true)
      setError(null)
      try {
        const next = await Promise.all(entries.map(async ([date, planId]): Promise<DaySummary> => {
          const base = { date, planId, status: 'missing' as const, taskCount: 0, doneCount: 0 }
          const resolved = await invoke('plan-reference:resolve', { library_id: libraryId, plan_id: planId })
          if (resolved.status !== 'found') return { ...base, status: resolved.status }
          const day = await invoke('storage:readPlan', { path: resolved.target.path })
          if (day.plan_id !== planId || day.workflow?.kind !== 'day' || day.workflow.target_date !== date) {
            return { ...base, status: 'conflict' }
          }
          const tasks = day.components.flatMap((component) => component.type === 'task_list'
            ? (component.payload as TaskListPayload).items.filter((task) => task.status !== 'moved') : [])
          return { date, planId, status: 'found', path: resolved.target.path,
            taskCount: tasks.length, doneCount: tasks.filter((task) => task.status === 'done').length }
        }))
        if (active && generation === generationRef.current) setDays(next)
      } catch (cause) {
        if (active && generation === generationRef.current) setError(cause instanceof Error ? cause.message : t('errors.opFailed'))
      } finally {
        if (active && generation === generationRef.current) setLoading(false)
      }
    }
    void load()
    const offPlan = onEvent('trace:plan-changed', () => { void load() })
    const offReference = onEvent('trace:reference-target-changed', (event) => {
      if (event.plan_ids.some((id) => entries.some(([_date, planId]) => planId === id))) void load()
    })
    return () => { active = false; generationRef.current += 1; offPlan(); offReference() }
  }, [libraryId, document.updated_at, entries, t])

  useEffect(() => {
    if (workflow?.kind !== 'week' || !document.plan_id) return
    let active = true
    const load = async (): Promise<void> => {
      try {
        const result = await invoke('plan-workflow:previewHandoff', { library_id: libraryId, week_plan_id: document.plan_id! })
        if (active) { setHandoff(result); setHandoffError(null) }
      } catch (cause) {
        if (active) setHandoffError(cause instanceof Error ? cause.message : t('errors.opFailed'))
      }
    }
    void load()
    const off = onEvent('trace:plan-changed', () => { void load() })
    return () => { active = false; off() }
  }, [libraryId, document.plan_id, document.updated_at, workflow?.kind, t])

  const move = async (task: WorkflowHandoffTask): Promise<void> => {
    if (!document.plan_id) return
    setMovingTask(task.source_task_id)
    setHandoffError(null)
    try {
      const result = await invoke('plan-workflow:moveTask', {
        library_id: libraryId, week_plan_id: document.plan_id,
        source_plan_id: task.source_plan_id, source_task_id: task.source_task_id,
        target_date: handoffTargets[task.source_task_id] ?? entries[0]?.[0]
      })
      if (result.status === 'partial') setHandoffError(t('workflow.handoffPartial'))
      else setHandoff(await invoke('plan-workflow:previewHandoff', { library_id: libraryId, week_plan_id: document.plan_id }))
    } catch (cause) {
      setHandoffError(cause instanceof Error ? cause.message : t('errors.opFailed'))
    } finally { setMovingTask(null) }
  }

  if (workflow?.kind !== 'week') return null
  const statusLabel = workflow.status === 'draft' ? t('workflow.weekStatusDraft')
    : workflow.status === 'active' ? t('workflow.weekStatusActive') : t('workflow.weekStatusClosed')
  return <section className="week-plan-overview" aria-label={t('workflow.weekSummary')}>
    <header><h2>{t('workflow.weekSummary')}</h2><span>{workflow.start_date} – {workflow.end_date}</span><span>{statusLabel}</span></header>
    {loading && <div role="status">{t('common.loading')}</div>}
    {error && <div role="alert">{error}</div>}
    <div className="week-plan-overview__days">
      {days.map((day) => <div className="week-plan-overview__day" key={day.date}>
        <strong>{day.date}</strong>
        {day.status === 'found' ? <>
          <span>{t('workflow.taskProgress', { done: day.doneCount, total: day.taskCount })}</span>
          <Button size="small" type="link" onClick={() => day.path && void useWorkspaceTabsStore.getState().openPlan(day.path)}>{t('workflow.openDay')}</Button>
        </> : <span>{t('workflow.missingDay')} · {t('workflow.repairHint')}</span>}
      </div>)}
    </div>
    {handoff && handoff.tasks.length > 0 && <div className="week-plan-overview__handoff">
      <h3>{t('workflow.handoffTitle')}</h3>
      <p>{t('workflow.handoffDescription')}</p>
      {handoff.tasks.map((task) => <div className="week-plan-overview__handoff-task" key={`${task.source_plan_id}:${task.source_task_id}`}>
        <span>{task.source_date} · {task.title}</span>
        <select aria-label={t('workflow.handoffTarget')} value={handoffTargets[task.source_task_id] ?? entries[0]?.[0]}
          onChange={(event) => setHandoffTargets((current) => ({ ...current, [task.source_task_id]: event.target.value }))}>
          {entries.map(([date]) => <option value={date} key={date}>{date}</option>)}
        </select>
        <Button size="small" disabled={movingTask !== null || entries.length === 0}
          onClick={() => void move(task)}>{t('workflow.moveTask')}</Button>
      </div>)}
    </div>}
    {handoffError && <div role="alert">{handoffError}</div>}
  </section>
}

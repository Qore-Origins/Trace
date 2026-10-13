import { ERR, TraceError } from '../../shared/errors'
import type { Component, PlanDocument, PlanWorkflowMetadata, TaskItem } from '../../shared/plan-types'
import type { WorkflowPreviewOutput } from '../../shared/plan-workflow-types'
import { isUuid32, uuid32, validateTitle } from '../../shared/validation'
import { validatePlanWorkflowMetadata, validateWorkflowDocumentForCreation } from '../../shared/plan-workflow-validation'

export interface WorkflowReferenceTarget {
  planId: string
  path: string
  name: string
}

export interface WorkflowCompileOptions {
  planId: string
  now?: Date
  idFactory?: () => string
  workflow?: PlanWorkflowMetadata
  referenceTargets?: Record<string, WorkflowReferenceTarget>
}

export function compileWorkflowDocument(output: WorkflowPreviewOutput, options: WorkflowCompileOptions): PlanDocument {
  if (!output || output.name === null || output.relative_path === null || output.conflicts.length > 0) {
    throw new TraceError(ERR.VALIDATION, '存在未解决冲突，不能编译计划内容')
  }
  if (!isUuid32(options.planId)) throw new TraceError(ERR.VALIDATION, '计划 ID 无效')
  const now = options.now ?? new Date()
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TraceError(ERR.VALIDATION, '计划创建时间无效')
  if (options.workflow !== undefined) validatePlanWorkflowMetadata(options.workflow)
  const timestamp = now.toISOString()
  const nextId = options.idFactory ?? uuid32
  const seenIds = new Set<string>([options.planId])
  const allocateId = (): string => {
    const id = nextId()
    if (!isUuid32(id) || seenIds.has(id)) throw new TraceError(ERR.VALIDATION, '生成的组件或任务 ID 无效或重复')
    seenIds.add(id)
    return id
  }

  const components: Component[] = output.components.map((template) => {
    validateTitle(template.title, '组件标题')
    const id = allocateId()
    if (template.type === 'heading') {
      return { id, type: 'heading', payload: { title: template.title, size: 2 } }
    }
    if (template.type === 'note') {
      const content = template.prompt
        ? `## ${template.title}\n\n${template.prompt}`
        : `## ${template.title}`
      return { id, type: 'note', payload: { content, created_at: timestamp } }
    }
    if (template.type === 'task_list') {
      const items: TaskItem[] = output.assigned_tasks.map((task) => ({
        id: allocateId(),
        title: task.title,
        status: 'not_started',
        ...(task.target_date ?? output.target_date ? { planned_at: task.target_date ?? output.target_date } : {})
      }))
      return { id, type: 'task_list', payload: { title: template.title, items } }
    }
    if (template.type === 'mood') {
      if (!output.target_date) throw new TraceError(ERR.VALIDATION, '心情组件需要明确的目标日期')
      return { id, type: 'mood', payload: { score: null, text: template.prompt ?? '', mood_date: output.target_date, created_at: timestamp } }
    }
    if (template.type === 'plan_reference') {
      const key = template.reference_output_key
      const target = key ? options.referenceTargets?.[key] : undefined
      if (!target || !isUuid32(target.planId)) {
        throw new TraceError(ERR.VALIDATION, '计划引用未解析到本批次的稳定目标 ID')
      }
      return {
        id,
        type: 'plan_reference',
        payload: {
          mode: 'link',
          target_plan_id: target.planId,
          target_path_snapshot: target.path,
          target_name_snapshot: target.name
        }
      }
    }
    throw new TraceError(ERR.VALIDATION, '不支持的内容模板组件类型')
  })
  const document: PlanDocument = {
    format_version: '1',
    plan_id: options.planId,
    created_at: timestamp,
    updated_at: timestamp,
    components,
    ...(options.workflow ? { workflow: structuredClone(options.workflow) } : {})
  }
  validateWorkflowDocumentForCreation(document)
  return document
}

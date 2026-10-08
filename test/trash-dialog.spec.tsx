// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TrashDialog from '../src/renderer/src/components/TrashDialog'
import { bindAntdHost } from '../src/renderer/src/antd-host'
import { i18n } from '../src/renderer/src/i18n'
import { useAppStore } from '../src/renderer/src/stores/app-store'
import { useTreeStore } from '../src/renderer/src/stores/tree-store'
import { ERR } from '../src/shared/errors'
import type { TrashEntry, TrashOperationPreview } from '../src/shared/trash-types'

const ENTRY_ID = '11111111111111111111111111111111'
const entry: TrashEntry = {
  id: ENTRY_ID, kind: 'plan', name: '旧计划', original_relative_path: '项目/旧计划',
  deleted_at: '2026-10-05T08:00:00.000Z', manifest_revision: 2,
  status: 'trashed', can_restore: true, can_purge: true
}
const restorePreview: TrashOperationPreview = {
  operation: 'restore', entry_id: ENTRY_ID, name: entry.name,
  original_relative_path: entry.original_relative_path, restore_relative_path: '归档/新计划',
  plan_count: 1, reference_count: 2, reference_impact_signature: 'refs',
  preview_digest: 'digest', confirmation_token: 'restore-confirm', expires_at: '2026-10-05T09:00:00.000Z'
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function operationPreview(
  entryId: string,
  operation: 'restore' | 'purge',
  token: string,
  restorePath?: string
): TrashOperationPreview {
  return {
    ...restorePreview,
    operation,
    entry_id: entryId,
    confirmation_token: token,
    restore_relative_path: restorePath,
    original_relative_path: `源位置/${entryId}`
  }
}

async function clickEntryAction(index: number, name: string): Promise<void> {
  const article = document.querySelectorAll<HTMLElement>('[data-trash-entry]')[index]
  if (!article) throw new Error(`Missing trash entry at index ${index}`)
  const target = Array.from(article.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.replace(/\s/g, '') === name.replace(/\s/g, '')
  )
  if (!target) throw new Error(`Missing ${name} action in trash entry ${index}`)
  await act(async () => target.click())
  await settle()
}

let host: HTMLDivElement
let root: Root
let oldBridge: PropertyDescriptor | undefined
let oldApp: ReturnType<typeof useAppStore.getState>
let oldTree: ReturnType<typeof useTreeStore.getState>
let calls: Array<{ channel: string; request: unknown }>

async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 10)))
}

async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) await settle()
  expect(predicate()).toBe(true)
}

function button(name: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (item) => item.textContent?.replace(/\s/g, '') === name.replace(/\s/g, '') || item.getAttribute('aria-label') === name
  )
  if (!result) throw new Error(`Missing button ${name}; available: ${Array.from(document.querySelectorAll('button')).map((item) => item.textContent?.trim()).join(', ')}`)
  return result
}

async function click(name: string): Promise<void> {
  await act(async () => button(name).click())
  await settle()
}

async function setSelect(name: string, value: string): Promise<void> {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${name}"]`)
  if (!select) throw new Error(`Missing select ${name}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await settle()
}

function setInput(name: string, value: string): void {
  const input = document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)
  if (!input) throw new Error(`Missing input ${name}`)
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

async function renderDialog(onClose: () => void = () => undefined): Promise<void> {
  await act(async () => root.render(<TrashDialog open onClose={onClose} />))
  await until(() => !!document.querySelector('[data-trash-entry]'))
}

async function startDeferredCommit(operation: 'restore' | 'purge'): Promise<{
  pending: ReturnType<typeof deferred<unknown>>
  commitCount: () => number
  feedback: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn>; warning: ReturnType<typeof vi.fn> }
}> {
  const pending = deferred<unknown>()
  let commits = 0
  const feedback = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
  bindAntdHost({ confirm: vi.fn() } as never, feedback as never)
  Object.defineProperty(window, 'trace', { configurable: true, value: {
    invoke: vi.fn((channel: string, request: unknown) => {
      calls.push({ channel, request })
      if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
      if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
      if (channel === `trash:${operation}-preview`) {
        return Promise.resolve({ ok: true, data: operationPreview(entry.id, operation, `${operation}-token`, '归档/旧计划') })
      }
      if (channel === `trash:${operation}-commit`) {
        commits += 1
        return pending.promise
      }
      throw new Error(`Unexpected ${channel}`)
    })
  } })
  const refreshAll = vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
  await renderDialog()
  await clickEntryAction(0, operation === 'restore' ? '恢复' : '永久清除')
  await until(() => document.querySelector('.trash-preview') !== null)
  if (operation === 'restore') {
    await setSelect('恢复到', '项目')
    await click('预览恢复')
    await until(() => document.querySelector('.trash-preview') !== null)
  }
  if (operation === 'purge') await act(async () => setInput('输入名称确认永久清除', entry.name))
  await click(operation === 'restore' ? '确认恢复' : '确认永久清除')
  await until(() => commits === 1)
  return { pending, commitCount: () => commits, feedback, refreshAll }
}

beforeEach(async () => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('zh-CN')
  oldBridge = Object.getOwnPropertyDescriptor(window, 'trace')
  oldApp = useAppStore.getState()
  oldTree = useTreeStore.getState()
  calls = []
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  bindAntdHost({ confirm: vi.fn() } as never, { success: vi.fn(), error: vi.fn(), warning: vi.fn() } as never)
})

afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  if (oldBridge) Object.defineProperty(window, 'trace', oldBridge)
  else Reflect.deleteProperty(window, 'trace')
  useAppStore.setState(oldApp)
  useTreeStore.setState(oldTree)
  vi.restoreAllMocks()
})

describe('plan library trash dialog', () => {
  it.each(['restore', 'purge'] as const)('keeps a single dialog mounted through the %s flow', async (operation) => {
    const pendingCommit = deferred<unknown>()
    let commitCount = 0
    let listCount = 0
    const feedback = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') {
          listCount += 1
          return Promise.resolve({ ok: true, data: listCount === 1 ? [entry] : [] })
        }
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        if (channel === `trash:${operation}-preview`) {
          return Promise.resolve({ ok: true, data: operationPreview(entry.id, operation, `${operation}-token`) })
        }
        if (channel === `trash:${operation}-commit`) {
          commitCount += 1
          return pendingCommit.promise
        }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    bindAntdHost({ confirm: vi.fn() } as never, feedback as never)
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()

    const dialogCount = (): number => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
      .filter((dialog) => !dialog.hidden && dialog.getAttribute('aria-hidden') !== 'true' &&
        window.getComputedStyle(dialog).display !== 'none' && window.getComputedStyle(dialog).visibility !== 'hidden')
      .length
    await renderDialog()
    expect(dialogCount()).toBe(1)

    await clickEntryAction(0, operation === 'restore' ? '恢复' : '永久清除')
    await until(() => document.querySelector('.trash-preview') !== null)
    expect(dialogCount()).toBe(1)

    if (operation === 'purge') await act(async () => setInput('输入名称确认永久清除', entry.name))
    await click(operation === 'restore' ? '确认恢复' : '确认永久清除')
    await until(() => commitCount === 1)
    expect(dialogCount()).toBe(1)

    await act(async () => pendingCommit.resolve({ ok: true, data: operation === 'restore'
      ? { path: '项目/旧计划', changed_plan_ids: [] }
      : { changed_plan_ids: [] }
    }))
    await until(() => feedback.success.mock.calls.length === 1)
    expect(dialogCount()).toBe(1)
  })

  it('lists the recoverable entry without treating it as a tree node', async () => {
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [entry] }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    expect(document.querySelector('[data-trash-entry]')?.textContent).toContain('旧计划')
    expect(document.querySelector('[data-trash-entry]')?.textContent).toContain('项目/旧计划')
    expect(calls.map((call) => call.channel)).toEqual(['trash:list'])
  })

  it('shows a readable localized reason for a quarantined entry without exposing its issue code', async () => {
    const issueEntry: TrashEntry = {
      ...entry,
      status: 'needs_attention',
      can_restore: false,
      can_purge: false,
      issue: 'identity_mismatch'
    }
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [issueEntry] }
        throw new Error(`Unexpected ${channel}`)
      })
    } })

    await renderDialog()

    const article = document.querySelector<HTMLElement>('[data-trash-entry]')
    expect(article?.textContent).toContain('回收站记录与实际内容的身份不匹配，可能已被替换。')
    expect(article?.textContent).not.toContain('identity_mismatch')
  })

  it.each([
    ['manifest_invalid', 'zh-CN', '回收站记录格式无效，无法安全处理该条目。请人工核查。'],
    ['manifest_invalid', 'en-US', 'The Trash record is invalid, so this item cannot be handled safely. Review it manually.'],
    ['entry_incomplete', 'zh-CN', '回收站条目不完整，恢复或清除信息可能缺失。请人工核查。'],
    ['entry_incomplete', 'en-US', 'The Trash entry is incomplete and may be missing restore or deletion data. Review it manually.'],
    ['identity_mismatch', 'en-US', 'The Trash record does not match the current item identity; the item may have been replaced. Review it manually.'],
    ['purge_interrupted', 'zh-CN', '该条目的永久清除曾中断，请核对现场后再处理。'],
    ['purge_interrupted', 'en-US', 'Permanent deletion was interrupted. Review the item state before continuing.'],
    ['private-diagnostic-path', 'zh-CN', '具体原因无法识别，已隐藏内部诊断信息，请人工核查。'],
    ['private-diagnostic-path', 'en-US', 'The reason is unknown. Internal diagnostic details are hidden; review this item manually.']
  ] as const)('localizes the safe review reason for %s in %s', async (issue, language, expectedReason) => {
    await i18n.changeLanguage(language)
    const issueEntry = {
      ...entry,
      status: 'needs_attention' as const,
      can_restore: false,
      can_purge: false,
      issue: issue as TrashEntry['issue']
    }
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [issueEntry] }
        throw new Error(`Unexpected ${channel}`)
      })
    } })

    await renderDialog()

    const article = document.querySelector<HTMLElement>('[data-trash-entry]')
    expect(article?.textContent).toContain(expectedReason)
    expect(article?.textContent).not.toContain(issue)
  })

  it('requires a main-process preview before restoring to a new name and refreshes the tree', async () => {
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [entry] }
        if (channel === 'trash:restore-preview') {
          const destination = (request as { destination?: { parent_path: string; name: string } }).destination
          if (!destination) return { ok: false, code: ERR.NAME_CONFLICT, message: 'Name conflict', data: null }
          expect(destination.parent_path).toBe('归档')
          expect(destination.name).toBe('新计划')
          return { ok: true, data: restorePreview }
        }
        if (channel === 'storage:treeGetChildren') return { ok: true, data: [
          { name: '项目', path: '项目', kind: 'folder', has_children: false },
          { name: '归档', path: '归档', kind: 'folder', has_children: false }
        ] }
        if (channel === 'trash:restore-commit') return { ok: true, data: { path: '项目/新计划', changed_plan_ids: [] } }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    const refresh = vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()
    await click('恢复')
    await until(() => !!document.querySelector('input[aria-label="恢复名称"]'))
    await until(() => !!document.querySelector('[role="alert"]'))
    await act(async () => setInput('恢复名称', '新计划'))
    await until(() => Array.from(document.querySelectorAll('select[aria-label="恢复到"] option')).some((option) => option.value === '归档'))
    await setSelect('恢复到', '归档')
    await click('预览恢复')
    await until(() => document.body.textContent?.includes('归档/新计划') ?? false)
    await click('确认恢复')
    await until(() => calls.some((call) => call.channel === 'trash:restore-commit'))
    expect(calls.filter((call) => call.channel === 'trash:restore-commit')).toEqual([
      { channel: 'trash:restore-commit', request: { confirmation_token: 'restore-confirm' } }
    ])
    expect(refresh).toHaveBeenCalled()
  })

  it('does not apply a cancelled old restore preview to a same-name entry with a different ID', async () => {
    const otherEntry: TrashEntry = { ...entry, id: '22222222222222222222222222222222' }
    const firstRequest = deferred<{ ok: true; data: TrashOperationPreview }>()
    const secondRequest = deferred<{ ok: true; data: TrashOperationPreview }>()
    const previewRequests = [firstRequest, secondRequest]
    const commitTokens: string[] = []
    let previewCount = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry, otherEntry] })
        if (channel === 'trash:restore-preview') return previewRequests[previewCount++].promise
        if (channel === 'trash:restore-commit') {
          commitTokens.push((request as { confirmation_token: string }).confirmation_token)
          return Promise.resolve({ ok: true, data: { path: 'restored', changed_plan_ids: [] } })
        }
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()

    await clickEntryAction(0, '恢复')
    await until(() => previewCount === 1)
    await click('取消')
    await clickEntryAction(1, '恢复')
    await until(() => previewCount === 2)

    await act(async () => firstRequest.resolve({
      ok: true,
      data: operationPreview(entry.id, 'restore', 'stale-a-token', '过期A/旧计划')
    }))
    await settle()
    expect(document.body.textContent).not.toContain('过期A/旧计划')
    expect(document.querySelector('.trash-preview')).toBeNull()
    expect(button('预览恢复').classList.contains('ant-btn-loading')).toBe(true)

    await act(async () => secondRequest.resolve({
      ok: true,
      data: operationPreview(otherEntry.id, 'restore', 'current-b-token', '当前B/旧计划')
    }))
    await until(() => document.body.textContent?.includes('当前B/旧计划') ?? false)
    await click('确认恢复')
    await until(() => commitTokens.length === 1)
    expect(commitTokens).toEqual(['current-b-token'])
  })

  it('does not let a cancelled restore rejection replace the current request error or busy state', async () => {
    const firstRequest = deferred<unknown>()
    const secondRequest = deferred<unknown>()
    const pending = [firstRequest, secondRequest]
    let previewCount = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === 'trash:restore-preview') return pending[previewCount++].promise
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await click('恢复')
    await until(() => previewCount === 1)
    await click('取消')
    await clickEntryAction(0, '恢复')
    await until(() => previewCount === 2)

    await act(async () => firstRequest.reject(new Error('stale request failed')))
    await settle()
    expect(document.body.textContent).not.toContain('回收站操作失败')
    expect(button('预览恢复').classList.contains('ant-btn-loading')).toBe(true)

    await act(async () => secondRequest.resolve({
      ok: true,
      data: operationPreview(entry.id, 'restore', 'latest-token', '当前请求/恢复目标')
    }))
    await until(() => document.body.textContent?.includes('当前请求/恢复目标') ?? false)
  })

  it.each(['restore', 'purge'] as const)('invalidates a pending %s preview when the dialog closes', async (operation) => {
    const pending = deferred<unknown>()
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === `trash:${operation}-preview`) return pending.promise
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    const onClose = vi.fn()
    await renderDialog(onClose)
    await clickEntryAction(0, operation === 'restore' ? '恢复' : '永久清除')

    await act(async () => root.render(<TrashDialog open={false} onClose={onClose} />))
    await settle()
    await act(async () => pending.resolve({
      ok: true,
      data: operationPreview(entry.id, operation, `late-${operation}-close`, '关闭后/不应出现')
    }))
    await settle()

    expect(document.querySelector('.trash-preview')).toBeNull()
    expect(document.body.textContent).not.toContain('关闭后/不应出现')
    expect(calls.some((call) => call.channel === `trash:${operation}-commit`)).toBe(false)
  })

  it('keeps only the newest destination when restore previews for the same entry return out of order', async () => {
    const laterDestination = deferred<unknown>()
    const newestDestination = deferred<unknown>()
    const commitTokens: string[] = []
    let destinationPreviewCount = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === 'trash:restore-preview') {
          const destination = (request as { destination?: { parent_path: string; name: string } }).destination
          if (!destination) return Promise.resolve({ ok: false, code: ERR.NAME_CONFLICT, message: 'conflict', data: null })
          destinationPreviewCount += 1
          return destinationPreviewCount === 1 ? laterDestination.promise : newestDestination.promise
        }
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        if (channel === 'trash:restore-commit') {
          commitTokens.push((request as { confirmation_token: string }).confirmation_token)
          return Promise.resolve({ ok: true, data: { path: 'restored', changed_plan_ids: [] } })
        }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()
    await click('恢复')
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes('同名内容') ?? false)

    await act(async () => setInput('恢复名称', '较早目标'))
    await click('预览恢复')
    await act(async () => setInput('恢复名称', '最新目标'))
    await click('预览恢复')
    expect(destinationPreviewCount).toBe(2)

    await act(async () => newestDestination.resolve({
      ok: true,
      data: operationPreview(entry.id, 'restore', 'newest-token', '归档/最新目标')
    }))
    await until(() => document.body.textContent?.includes('归档/最新目标') ?? false)
    await act(async () => laterDestination.resolve({
      ok: true,
      data: operationPreview(entry.id, 'restore', 'older-token', '归档/较早目标')
    }))
    await settle()

    expect(document.body.textContent).toContain('归档/最新目标')
    expect(document.body.textContent).not.toContain('归档/较早目标')
    await click('确认恢复')
    await until(() => commitTokens.length === 1)
    expect(commitTokens).toEqual(['newest-token'])
  })

  it('does not apply a cancelled purge preview to a same-name entry with a different ID', async () => {
    const otherEntry: TrashEntry = { ...entry, id: '22222222222222222222222222222222' }
    const firstRequest = deferred<unknown>()
    const secondRequest = deferred<unknown>()
    const pending = [firstRequest, secondRequest]
    const commitTokens: string[] = []
    let previewCount = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry, otherEntry] })
        if (channel === 'trash:purge-preview') return pending[previewCount++].promise
        if (channel === 'trash:purge-commit') {
          commitTokens.push((request as { confirmation_token: string }).confirmation_token)
          return Promise.resolve({ ok: true, data: { changed_plan_ids: [] } })
        }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()

    await clickEntryAction(0, '永久清除')
    await until(() => previewCount === 1)
    await click('取消')
    await clickEntryAction(1, '永久清除')
    await until(() => previewCount === 2)

    await act(async () => firstRequest.resolve({
      ok: true,
      data: operationPreview(entry.id, 'purge', 'stale-purge-token')
    }))
    await settle()
    expect(document.querySelector('.trash-preview')).toBeNull()
    expect(button('确认永久清除').disabled).toBe(true)

    await act(async () => secondRequest.resolve({
      ok: true,
      data: operationPreview(otherEntry.id, 'purge', 'current-purge-token')
    }))
    await until(() => document.querySelector('.trash-preview') !== null)
    await act(async () => setInput('输入名称确认永久清除', '旧计划'))
    await click('确认永久清除')
    await until(() => commitTokens.length === 1)
    expect(commitTokens).toEqual(['current-purge-token'])
  })

  it.each(['restore', 'purge'] as const)('invalidates a pending %s preview after switching libraries', async (operation) => {
    const pending = deferred<unknown>()
    useAppStore.setState({ rootDir: 'D:\\Library A' })
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === `trash:${operation}-preview`) return pending.promise
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await clickEntryAction(0, operation === 'restore' ? '恢复' : '永久清除')

    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library B' }))
    await settle()
    await act(async () => pending.resolve({
      ok: true,
      data: operationPreview(entry.id, operation, `stale-${operation}-token`, '旧库/旧计划')
    }))
    await settle()

    expect(document.querySelector('.trash-preview')).toBeNull()
    expect(document.body.textContent).not.toContain('旧库/旧计划')
    expect(calls.some((call) => call.channel === `trash:${operation}-commit`)).toBe(false)
  })

  it.each(['restore', 'purge'] as const)('rejects a %s preview response with a mismatched operation or entry ID', async (operation) => {
    let previewCount = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        if (channel === `trash:${operation}-preview`) {
          previewCount += 1
          const wrongOperation = operation === 'restore' ? 'purge' : 'restore'
          return Promise.resolve({ ok: true, data: previewCount === 1
            ? operationPreview(entry.id, wrongOperation, `wrong-operation-${operation}`)
            : operationPreview('99999999999999999999999999999999', operation, `wrong-entry-${operation}`)
          })
        }
        if (channel === `trash:${operation}-commit`) return Promise.resolve({ ok: true, data: { changed_plan_ids: [] } })
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await clickEntryAction(0, operation === 'restore' ? '恢复' : '永久清除')
    await until(() => document.body.textContent?.includes('条目或关联已变化') ?? false)
    expect(document.querySelector('.trash-preview')).toBeNull()

    if (operation === 'restore') await click('预览恢复')
    else await click('重试')
    await until(() => previewCount === 2)
    await until(() => document.body.textContent?.includes('条目或关联已变化') ?? false)
    expect(document.querySelector('.trash-preview')).toBeNull()

    if (operation === 'purge') await act(async () => setInput('输入名称确认永久清除', entry.name))
    if (operation === 'purge') expect(button('确认永久清除').disabled).toBe(true)
    expect(calls.some((call) => call.channel === `trash:${operation}-commit`)).toBe(false)
  })

  it.each([
    ['zh-CN', '回收站操作失败，请重试', '重试'],
    ['en-US', 'Trash operation failed. Retry.', 'Retry']
  ] as const)('shows a localized retry when loading restore folders fails (%s)', async (language, errorText, retryText) => {
    await i18n.changeLanguage(language)
    let folderAttempts = 0
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return Promise.resolve({ ok: true, data: [entry] })
        if (channel === 'trash:restore-preview') return Promise.resolve({ ok: false, code: ERR.NAME_CONFLICT, message: 'conflict', data: null })
        if (channel === 'storage:treeGetChildren') {
          folderAttempts += 1
          return folderAttempts === 1
            ? Promise.reject(new Error('unavailable'))
            : Promise.resolve({ ok: true, data: [{ name: 'Archive', path: 'Archive', kind: 'folder', has_children: false }] })
        }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await click(language === 'zh-CN' ? '恢复' : 'Restore')
    await until(() => document.querySelector('.trash-parent-picker') !== null)
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes(errorText) ?? false)
    expect(button(retryText)).toBeTruthy()

    await click(retryText)
    await until(() => folderAttempts === 2)
    const restoreParentLabel = i18n.t('trash.restoreParent')
    await until(() => Array.from(document.querySelectorAll(`select[aria-label="${restoreParentLabel}"] option`))
      .some((option) => option.value === 'Archive'))
    expect(document.querySelector('[role="alert"]')?.textContent ?? '').not.toContain(errorText)
  })

  it('reports refresh failure after the restore has committed and clears stale entries', async () => {
    let listCount = 0
    const feedback = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    bindAntdHost({ confirm: vi.fn() } as never, feedback as never)
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') {
          listCount += 1
          return listCount === 1
            ? { ok: true, data: [entry] }
            : { ok: false, code: ERR.INTERNAL, message: 'refresh failed', data: null }
        }
        if (channel === 'trash:restore-preview') return { ok: true, data: restorePreview }
        if (channel === 'trash:restore-commit') return { ok: true, data: { path: '归档/新计划', changed_plan_ids: [] } }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()
    await click('恢复')
    await until(() => button('确认恢复').disabled === false)
    await click('确认恢复')
    await until(() => feedback.warning.mock.calls.length === 1)
    expect(feedback.success).not.toHaveBeenCalled()
    expect(document.querySelector('[data-trash-entry]')).toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('回收站载入失败')
  })

  it('keeps permanent deletion unavailable when the user cancels its preview', async () => {
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [entry] }
        if (channel === 'trash:purge-preview') return { ok: true, data: {
          ...restorePreview, operation: 'purge', confirmation_token: 'purge-confirm', restore_relative_path: undefined
        } }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await click('永久清除')
    await until(() => !!document.querySelector('input[aria-label="输入名称确认永久清除"]'))
    await click('取消')
    expect(calls.some((call) => call.channel === 'trash:purge-commit')).toBe(false)
  })

  it('does not permanently clear an entry until the user completes the independent typed confirmation', async () => {
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn(async (channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') return { ok: true, data: [entry] }
        if (channel === 'trash:purge-preview') return { ok: true, data: {
          ...restorePreview, operation: 'purge', confirmation_token: 'purge-confirm', restore_relative_path: undefined
        } }
        if (channel === 'trash:purge-commit') return { ok: true, data: { changed_plan_ids: [] } }
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    await renderDialog()
    await click('永久清除')
    await until(() => !!document.querySelector('input[aria-label="输入名称确认永久清除"]'))
    expect(button('确认永久清除').disabled).toBe(true)
    await act(async () => setInput('输入名称确认永久清除', '旧计划'))
    expect(button('确认永久清除').disabled).toBe(false)
    await click('确认永久清除')
    expect(calls.filter((call) => call.channel === 'trash:purge-commit')).toEqual([
      { channel: 'trash:purge-commit', request: { confirmation_token: 'purge-confirm' } }
    ])
  })

  it.each(['restore', 'purge'] as const)('locks %s dismissal and identity fields while commit is in flight', async (operation) => {
    const { pending, commitCount, feedback } = await startDeferredCommit(operation)
    const selector = operation === 'restore'
      ? 'input[aria-label="恢复名称"]'
      : 'input[aria-label="输入名称确认永久清除"]'
    const field = document.querySelector<HTMLInputElement>(selector)
    expect(field).not.toBeNull()
    const initialValue = field!.value
    const closeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.ant-modal-close'))
    const browseCallsBefore = calls.filter((call) => call.channel === 'storage:treeGetChildren').length

    const interactableBefore = document.querySelectorAll('.ant-modal-wrap').length
    await act(async () => {
      for (const closeButton of closeButtons) closeButton.click()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      const topModal = document.querySelectorAll<HTMLElement>('.ant-modal-wrap').item(1)
      topModal?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      button('取消').click()
    })
    await settle()

    expect(field!.disabled).toBe(true)
    expect(field!.value).toBe(initialValue)
    expect(button('取消').disabled).toBe(true)
    expect(document.querySelectorAll('.ant-modal-wrap').length).toBe(interactableBefore)
    expect(commitCount()).toBe(1)
    if (operation === 'restore') {
      expect(document.querySelector<HTMLSelectElement>('select[aria-label="恢复到"]')?.disabled).toBe(true)
      expect(button('上级').disabled).toBe(true)
      expect(calls.filter((call) => call.channel === 'storage:treeGetChildren')).toHaveLength(browseCallsBefore)
    }

    await act(async () => pending.resolve({ ok: true, data: operation === 'restore'
      ? { path: '归档/旧计划', changed_plan_ids: [] }
      : { changed_plan_ids: [] }
    }))
    await until(() => feedback.success.mock.calls.length === 1)
  })

  it.each(['restore', 'purge'] as const)('reports a successful %s commit if the library changes before its response', async (operation) => {
    const { pending, feedback, refreshAll } = await startDeferredCommit(operation)
    const listCallsBeforeSwitch = calls.filter((call) => call.channel === 'trash:list').length
    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library B' }))
    await until(() => calls.filter((call) => call.channel === 'trash:list').length > listCallsBeforeSwitch)
    const listCallsBeforeCommitResponse = calls.filter((call) => call.channel === 'trash:list').length

    await act(async () => pending.resolve({ ok: true, data: operation === 'restore'
      ? { path: '归档/旧计划', changed_plan_ids: [] }
      : { changed_plan_ids: [] }
    }))
    await until(() => feedback.success.mock.calls.length === 1)

    expect(feedback.warning).not.toHaveBeenCalled()
    expect(feedback.error).not.toHaveBeenCalled()
    expect(refreshAll).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.channel === 'trash:list')).toHaveLength(listCallsBeforeCommitResponse)
  })

  it.each(['restore', 'purge'] as const)('reports a failed %s commit if the library changes before its response', async (operation) => {
    const { pending, feedback, refreshAll } = await startDeferredCommit(operation)
    const listCallsBeforeSwitch = calls.filter((call) => call.channel === 'trash:list').length
    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library B' }))
    await until(() => calls.filter((call) => call.channel === 'trash:list').length > listCallsBeforeSwitch)
    const listCallsBeforeCommitResponse = calls.filter((call) => call.channel === 'trash:list').length

    await act(async () => pending.reject(new Error('commit failed')))
    await until(() => feedback.error.mock.calls.length === 1)

    expect(feedback.success).not.toHaveBeenCalled()
    expect(feedback.warning).not.toHaveBeenCalled()
    expect(refreshAll).not.toHaveBeenCalled()
    expect(calls.filter((call) => call.channel === 'trash:list')).toHaveLength(listCallsBeforeCommitResponse)
  })

  it('reports a completed restore if the dialog closes while the commit is pending', async () => {
    const { pending, feedback } = await startDeferredCommit('restore')
    await act(async () => root.render(<TrashDialog open={false} onClose={() => undefined} />))
    await act(async () => pending.resolve({ ok: true, data: { path: '归档/旧计划', changed_plan_ids: [] } }))
    await until(() => feedback.success.mock.calls.length === 1)
    expect(feedback.error).not.toHaveBeenCalled()
  })

  it('does not report refresh failure when a superseded commit refresh is replaced during an A-B-A library switch', async () => {
    const commitRefresh = deferred<unknown>()
    const latestEntry: TrashEntry = {
      ...entry, name: '最新计划', original_relative_path: '最新库/最新计划'
    }
    let listCalls = 0
    const feedback = { success: vi.fn(), error: vi.fn(), warning: vi.fn() }
    bindAntdHost({ confirm: vi.fn() } as never, feedback as never)
    useAppStore.setState({ rootDir: 'D:\\Library A' })
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel === 'trash:list') {
          listCalls += 1
          if (listCalls === 1) return Promise.resolve({ ok: true, data: [entry] })
          if (listCalls === 2) return commitRefresh.promise
          if (listCalls === 3) return Promise.resolve({ ok: true, data: [] })
          if (listCalls === 4) return Promise.resolve({ ok: true, data: [latestEntry] })
        }
        if (channel === 'trash:restore-preview') {
          return Promise.resolve({ ok: true, data: operationPreview(entry.id, 'restore', 'restore-token') })
        }
        if (channel === 'trash:restore-commit') {
          return Promise.resolve({ ok: true, data: { path: entry.original_relative_path, changed_plan_ids: [] } })
        }
        if (channel === 'storage:treeGetChildren') return Promise.resolve({ ok: true, data: [] })
        throw new Error(`Unexpected ${channel}`)
      })
    } })
    vi.spyOn(useTreeStore.getState(), 'refreshAll').mockResolvedValue()
    await renderDialog()
    await click('恢复')
    await until(() => document.querySelector('.trash-preview') !== null)
    await click('确认恢复')
    await until(() => listCalls === 2)

    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library B' }))
    await until(() => listCalls === 3)
    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library A' }))
    await until(() => listCalls === 4)
    await until(() => document.querySelector('[data-trash-entry]')?.textContent?.includes('最新库/最新计划') ?? false)

    await act(async () => commitRefresh.resolve({ ok: true, data: [entry] }))
    await until(() => feedback.success.mock.calls.length === 1)

    expect(feedback.warning).not.toHaveBeenCalled()
    expect(feedback.error).not.toHaveBeenCalled()
    expect(document.querySelector('[data-trash-entry]')?.textContent).toContain('最新库/最新计划')
  })

  it('hides old-library entries until the new library trash list has completed', async () => {
    const nextLibraryEntry: TrashEntry = {
      ...entry, id: '22222222222222222222222222222222', original_relative_path: '新库/旧计划'
    }
    const nextList = deferred<unknown>()
    let listCalls = 0
    useAppStore.setState({ rootDir: 'D:\\Library A' })
    Object.defineProperty(window, 'trace', { configurable: true, value: {
      invoke: vi.fn((channel: string, request: unknown) => {
        calls.push({ channel, request })
        if (channel !== 'trash:list') throw new Error(`Unexpected ${channel}`)
        listCalls += 1
        return listCalls === 1 ? Promise.resolve({ ok: true, data: [entry] }) : nextList.promise
      })
    } })
    await renderDialog()
    expect(document.querySelector('[data-trash-entry]')?.textContent).toContain('项目/旧计划')

    await act(async () => useAppStore.setState({ rootDir: 'D:\\Library B' }))
    await until(() => listCalls === 2)
    expect(document.querySelector('[data-trash-entry]')).toBeNull()
    expect(document.body.textContent).not.toContain('项目/旧计划')

    await act(async () => nextList.resolve({ ok: true, data: [nextLibraryEntry] }))
    await until(() => document.querySelector('[data-trash-entry]')?.textContent?.includes('新库/旧计划') ?? false)
    expect(document.querySelector('[data-trash-entry]')?.textContent).not.toContain('项目/旧计划')
  })
})

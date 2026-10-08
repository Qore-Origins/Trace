// IPC 注册层：白名单通道 → 主进程 handler；统一校验包装（异常 → TraceResult + 脱敏日志）
import { BrowserWindow, ipcMain, dialog, type IpcMainInvokeEvent } from 'electron'
import { promises as fs } from 'node:fs'
import { basename } from 'node:path'
import { toTraceResultError, ERR, TraceError } from '../../shared/errors'
import type { TraceEvents } from '../services/event-bus'
import { fail, ok, type AgentApprovalChannelName, type AgentApprovalChannels, type ChannelName, type Channels, type TraceResult } from '../../shared/ipc-contract'
import { AppService } from '../services/app-service'
import { StorageService } from '../services/storage-service'
import { ConfigService } from '../services/config-service'
import { TransferService } from '../services/transfer-service'
import { ExportService } from '../services/export-service'
import { SearchService } from '../services/search-service'
import type { PlanNameTemplateService } from '../services/plan-name-template-service'
import type { WorkspaceTabsService } from '../services/workspace-tabs-service'
import type { PlanReferenceService } from '../services/plan-reference-service'
import { DIARY_DIR, ensureDiaryRoot, ensureTodayPageWithResult, listMemories, listMonthEntries, listYearEntries, readDaySummary } from '../services/diary-service'
import { todayDateStr } from '../../shared/validation'
import { bus } from '../services/event-bus'
import type { PlantumlService } from '../services/plantuml-service'
import type { StartupCoordinator } from '../services/startup-coordinator'
import { AgentProfileService } from '../services/agent-profile-service'
import { AgentConversationService } from '../services/agent-conversation-service'
import { AgentSessionRepository } from '../services/agent-session-repository'
import { AgentContextService } from '../services/agent-context-service'
import { AgentRequestService } from '../services/agent-request-service'
import { AgentTargetService } from '../services/agent-target-service'
import { AgentPolicyService } from '../services/agent-policy-service'
import { AgentOperationService } from '../services/agent-operation-service'
import type { AgentOperationTrustedConfirmationPresenter } from '../services/agent-operation-service'
import { registerAgentApprovalIpc } from './agent-approval-ipc'
import type { AgentOutboundApproval, AgentApprovalWindowService } from '../services/agent-approval-window-service'
import type { AgentApprovalRequestSnapshot, AgentOperationBatch } from '../../shared/agent-types'
import type { TrashPurgeConfirmationSnapshot } from '../services/trash-service'
import type { TrashOperationCommitResult } from '../../shared/trash-types'
import type { AgentProviderTool } from '../services/agent-provider'
import { registerAgentConversationIpc, registerAgentOperationIpc, registerAgentPolicyIpc, registerAgentTargetIpc } from './agent-conversation-ipc'
import { DEFAULT_PLANTUML_PORT, validatePlantumlPort, type PlantUmlStatusDto } from '../../shared/plantuml-types'

interface Deps {
  app: AppService
  storage: StorageService
  config: ConfigService
  transfer: TransferService
  export: ExportService
  search: SearchService
  planNameTemplates?: PlanNameTemplateService
  workspaceTabs?: WorkspaceTabsService
  planReferences?: PlanReferenceService
  plantuml?: PlantumlService
  startup: StartupCoordinator
  captureDiaryRootGuard?: (root: string) => () => boolean
  getWindow: () => BrowserWindow | null
  log: (channel: string, code: number, detail?: string) => void
  agentProfiles?: AgentProfileService
  agentUserDataDir?: string
  agentConversations?: AgentConversationService
  agentPolicyService?: AgentPolicyService
  agentTargetService?: AgentTargetService
  agentToolDefinitions?: () => readonly AgentProviderTool[]
  agentApprovalWindowService?: AgentApprovalWindowService
  /** Main-process test seam. Production must provide the isolated window service. */
  requestAgentApproval?: AgentOutboundApproval
  /** Main-process-only test seam. Production renders the trusted isolated confirmation window. */
  requestTrustedOperationConfirmation?: AgentOperationTrustedConfirmationPresenter
  /** Main-process-only test seam. Production renders the trusted isolated confirmation window. */
  requestTrustedTrashPurgeConfirmation?: (
    snapshot: Readonly<TrashPurgeConfirmationSnapshot>,
    accept: () => Promise<TrashOperationCommitResult>
  ) => Promise<void>
}

type IpcChannels = Channels & AgentApprovalChannels
type IpcChannelName = keyof IpcChannels
type RequestFor<K extends IpcChannelName> = IpcChannels[K]['req']
type ResponseFor<K extends IpcChannelName> = IpcChannels[K]['res']
type Handler<K extends IpcChannelName> = (payload: RequestFor<K>, event: IpcMainInvokeEvent) => Promise<ResponseFor<K>>

interface PlantumlConfiguration {
  enabled: boolean
  port: number
}

const LOCAL_CONFIRMATION_TITLE = 'Trace Local Operation Confirmation'
const LOCAL_CONFIRMATION_ACCEPT_URL = 'trace-local-confirmation://accept'
const LOCAL_CONFIRMATION_CANCEL_URL = 'trace-local-confirmation://cancel'

type TrustedLocalConfirmationContent =
  | { kind: 'agent-operation'; snapshot: Readonly<import('../services/agent-operation-service').AgentOperationConfirmationSnapshot> }
  | { kind: 'trash-purge'; snapshot: Readonly<TrashPurgeConfirmationSnapshot> }

function escapeConfirmationHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character] as string)
}

function confirmationHtml(content: TrustedLocalConfirmationContent): string {
  let summary: string
  let rootAttributes: string
  if (content.kind === 'agent-operation') {
    const snapshot = content.snapshot
    rootAttributes = `data-confirmation-kind="agent-operation" data-operation-batch-id="${escapeConfirmationHtml(snapshot.batchId)}"`
    const operations = snapshot.operations.map((operation) => {
      const path = operation.targetPath ?? '计划库根目录'
      return `<article data-confirm-operation-id="${escapeConfirmationHtml(operation.callId)}" data-confirm-operation-name="${escapeConfirmationHtml(operation.operation)}" data-confirm-target-path="${escapeConfirmationHtml(path)}"><h2>${escapeConfirmationHtml(operation.operation)}</h2><p>对象：${escapeConfirmationHtml(operation.targetKind ?? 'plan')} / ${escapeConfirmationHtml(path)}</p><pre data-confirm-operation-changes="true">${escapeConfirmationHtml(JSON.stringify(operation.changes, null, 2))}</pre></article>`
    }).join('')
    const impacts = content.snapshot.confirmationPreview
      ? `<section><h2>关联影响与范围</h2><pre data-confirmation-impact="true">${escapeConfirmationHtml(JSON.stringify(content.snapshot.confirmationPreview, null, 2))}</pre></section>`
      : ''
    const decisions = `<section><h2>本次操作决定</h2><pre data-confirmation-decisions="true">${escapeConfirmationHtml(JSON.stringify(snapshot.decisions, null, 2))}</pre></section>`
    summary = `${operations}${impacts}${decisions}<p>确认有效期至 ${escapeConfirmationHtml(snapshot.expiresAt)}</p>`
  } else {
    const snapshot = content.snapshot
    rootAttributes = `data-confirmation-kind="trash-purge" data-trash-entry-id="${escapeConfirmationHtml(snapshot.entry_id)}" data-trash-target-path="${escapeConfirmationHtml(snapshot.original_relative_path)}"`
    summary = `<article data-trash-entry-id="${escapeConfirmationHtml(snapshot.entry_id)}" data-trash-entry-name="${escapeConfirmationHtml(snapshot.name)}" data-trash-target-path="${escapeConfirmationHtml(snapshot.original_relative_path)}"><h2>永久清除回收站条目</h2><dl><dt>对象</dt><dd>${escapeConfirmationHtml(snapshot.kind)} / ${escapeConfirmationHtml(snapshot.name)}</dd><dt>原位置</dt><dd>${escapeConfirmationHtml(snapshot.original_relative_path)}</dd><dt>计划数</dt><dd>${snapshot.plan_count}</dd><dt>关联数量</dt><dd>${snapshot.reference_count}</dd><dt>当前状态</dt><dd>${escapeConfirmationHtml(snapshot.status)}</dd><dt>确认有效期至</dt><dd>${escapeConfirmationHtml(snapshot.expires_at)}</dd></dl></article>`
  }

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${LOCAL_CONFIRMATION_TITLE}</title><style>html{color-scheme:light dark}body{font:14px/1.55 system-ui,sans-serif;margin:0;padding:24px;background:#f4f6f8;color:#202833}main{max-width:760px;margin:0 auto}h1{font-size:20px;margin:0 0 16px}h2{font-size:15px;margin:0 0 8px}article,section{padding:14px;margin:0 0 12px;border:1px solid #ccd4df;border-radius:8px;background:#fff}p{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f4f7;padding:10px;border-radius:6px;max-height:240px;overflow:auto}dl{display:grid;grid-template-columns:150px 1fr;gap:8px;margin:8px 0}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}a{display:inline-block;padding:9px 16px;border-radius:6px;text-decoration:none;color:#202833;border:1px solid #aab4c2;background:#fff}a[data-confirm-action="accept"]{background:#315f9d;border-color:#315f9d;color:#fff}</style></head><body><main data-confirmation-summary="true" ${rootAttributes}><h1>${LOCAL_CONFIRMATION_TITLE}</h1>${summary}<nav class="actions"><a role="button" data-confirm-action="cancel" href="${LOCAL_CONFIRMATION_CANCEL_URL}">取消</a><a role="button" data-confirm-action="accept" href="${LOCAL_CONFIRMATION_ACCEPT_URL}">确认并执行</a></nav></main></body></html>`
}

async function showTrustedLocalConfirmation<T>(
  owner: BrowserWindow,
  content: TrustedLocalConfirmationContent,
  accept: () => Promise<T>,
  isOwnerCurrent: () => boolean
): Promise<T | null> {
  const expiresAt = Date.parse(content.kind === 'agent-operation' ? content.snapshot.expiresAt : content.snapshot.expires_at)
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || owner.isDestroyed() || owner.webContents.isDestroyed()) return null

  let confirmationWindow: BrowserWindow
  try {
    confirmationWindow = new BrowserWindow({
      title: LOCAL_CONFIRMATION_TITLE,
      parent: owner,
      modal: true,
      show: false,
      width: 820,
      height: 680,
      minWidth: 560,
      minHeight: 420,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
  } catch {
    return null
  }

  confirmationWindow.setMenu(null)
  confirmationWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const html = confirmationHtml(content)
  const url = `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`

  return new Promise<T | null>((resolve, reject) => {
    let settled = false
    let acceptanceStarted = false
    const expiryTimer = setTimeout(() => { if (!acceptanceStarted) settle(null) }, Math.max(0, expiresAt - Date.now()))
    const settle = (result: T | null): void => {
      if (settled) return
      settled = true
      clearTimeout(expiryTimer)
      if (!confirmationWindow.isDestroyed()) confirmationWindow.close()
      resolve(result)
    }
    const failClosed = (): void => {
      if (acceptanceStarted) return
      settle(null)
    }

    confirmationWindow.on('closed', () => {
      if (!acceptanceStarted) settle(null)
    })
    confirmationWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      event.preventDefault()
      if (settled || acceptanceStarted || !isOwnerCurrent() || Date.now() >= expiresAt) return
      if (navigationUrl === LOCAL_CONFIRMATION_CANCEL_URL) {
        settle(null)
        return
      }
      if (navigationUrl !== LOCAL_CONFIRMATION_ACCEPT_URL) return
      acceptanceStarted = true
      void accept().then((result) => settle(result), (error: unknown) => {
        if (settled) return
        settled = true
        clearTimeout(expiryTimer)
        if (!confirmationWindow.isDestroyed()) confirmationWindow.close()
        reject(error)
      })
    })
    confirmationWindow.webContents.on('will-redirect', (event) => event.preventDefault())
    confirmationWindow.webContents.on('did-fail-load', (_event, errorCode) => { if (errorCode !== -3) failClosed() })
    confirmationWindow.webContents.on('render-process-gone', failClosed)
    void confirmationWindow.loadURL(url).then(() => {
      if (settled || acceptanceStarted || Date.now() >= expiresAt || !isOwnerCurrent() || confirmationWindow.isDestroyed()) {
        failClosed()
        return
      }
      confirmationWindow.show()
    }, failClosed)
  })
}

function parsePlantumlConfiguration(payload: unknown): PlantumlConfiguration {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.getPrototypeOf(payload) !== Object.prototype
  ) {
    throw new TraceError(ERR.VALIDATION, 'PlantUML 配置载荷无效')
  }

  const keys = Reflect.ownKeys(payload)
  if (keys.length !== 2 || !keys.includes('enabled') || !keys.includes('port')) {
    throw new TraceError(ERR.VALIDATION, 'PlantUML 配置仅允许 enabled 和 port')
  }

  const enabledDescriptor = Object.getOwnPropertyDescriptor(payload, 'enabled')
  const portDescriptor = Object.getOwnPropertyDescriptor(payload, 'port')
  if (!enabledDescriptor || !('value' in enabledDescriptor) || !portDescriptor || !('value' in portDescriptor)) {
    throw new TraceError(ERR.VALIDATION, 'PlantUML 配置载荷无效')
  }

  const { value: enabled } = enabledDescriptor
  const { value: port } = portDescriptor
  if (typeof enabled !== 'boolean' || typeof port !== 'number' || !Number.isInteger(port)) {
    throw new TraceError(ERR.VALIDATION, 'PlantUML 配置载荷无效')
  }

  try {
    validatePlantumlPort(port)
  } catch {
    throw new TraceError(ERR.VALIDATION, 'PlantUML 端口必须为 1024–65535 的整数')
  }
  return { enabled, port }
}

// wrapHandler：TraceError/未知异常 → { ok:false, code, message }；日志只含通道+错误码+消息（不含计划正文）
// 未知异常（INTERNAL）额外打完整栈到主进程控制台——否则真实原因被笼统消息吞掉无法定位
function wrap<K extends IpcChannelName>(name: K, handler: Handler<K>, log: Deps['log']) {
  return async (event: IpcMainInvokeEvent, payload: RequestFor<K>): Promise<TraceResult<ResponseFor<K>>> => {
    try {
      const data = await handler(payload, event)
      log(name, ERR.OK)
      return ok(data)
    } catch (e) {
      const { code, message } = toTraceResultError(e)
      if (name.startsWith('trace:agent-approval:')) {
        const safeMessage = '外发确认窗口操作失败'
        log(name, code, safeMessage)
        return fail(code, safeMessage) as TraceResult<ResponseFor<K>>
      }
      if (name.startsWith('agent:')) {
        const safeMessage = code === ERR.VALIDATION || code === ERR.PATH_NOT_FOUND ? message : '服务配置操作失败'
        log(name, code, safeMessage)
        return fail(code, safeMessage) as TraceResult<ResponseFor<K>>
      }
      if (name.startsWith('diary:')) {
        // 文件系统异常可能携带绝对路径/正文；日记边界只返回固定的可重试提示。
        const safeMessage = name === 'diary:ensure' ? '日记初始化失败，请稍后重试' : '日记读取失败，请稍后重试'
        log(name, code, safeMessage)
        return fail(code, safeMessage) as TraceResult<ResponseFor<K>>
      }
      if (name.startsWith('plan-reference:')) {
        // Filesystem failures may contain absolute paths; reference responses and logs never echo them.
        const safeMessage = e instanceof TraceError ? message : '引用操作失败，请重试'
        log(name, code, safeMessage)
        return fail(code, safeMessage) as TraceResult<ResponseFor<K>>
      }
      if (name.startsWith('trash:')) {
        const safeMessage = e instanceof TraceError ? message : '回收站操作失败，请重试'
        log(name, code, safeMessage)
        return fail(code, safeMessage) as TraceResult<ResponseFor<K>>
      }
      log(name, code, message)
      if (code === ERR.INTERNAL) console.error(`[ipc] ${name} internal:`, e)
      return fail(code, message) as TraceResult<ResponseFor<K>>
    }
  }
}

export function registerIpc(deps: Deps): () => void {
  const { app, storage, config, transfer, search, getWindow, log, plantuml, startup } = deps
  const registeredChannels: ChannelName[] = []
  const registeredLegacyChannels: string[] = []
  const unsubscribeListeners: Array<() => void> = []
  let disposed = false
  let rootStateQueue = Promise.resolve()
  let disposeAgentApprovalIpc: (() => void) | undefined
  const approveAgentOutbound: AgentOutboundApproval = deps.requestAgentApproval ??
    (deps.agentApprovalWindowService
      ? (snapshot: AgentApprovalRequestSnapshot) => deps.agentApprovalWindowService!.requestApproval(snapshot)
      : async () => false)
  const reg = <K extends ChannelName>(name: K, handler: Handler<K>) => {
    ipcMain.handle(name, wrap(name, handler, log))
    registeredChannels.push(name)
  }
  const regRootState = <K extends ChannelName>(name: K, handler: Handler<K>) => {
    const wrapped = wrap(name, handler, log)
    ipcMain.handle(name, (event, payload) => {
      const operation = rootStateQueue.then(() => wrapped(event, payload as Channels[K]['req']))
      rootStateQueue = operation.then(() => undefined, () => undefined)
      return operation
    })
    registeredChannels.push(name)
  }

  if (deps.agentApprovalWindowService) {
    const registerApproval = <K extends AgentApprovalChannelName>(name: K, handler: Handler<K>) => {
      ipcMain.handle(name, wrap(name, handler, log))
    }
    disposeAgentApprovalIpc = registerAgentApprovalIpc(
      deps.agentApprovalWindowService,
      registerApproval,
      (name) => ipcMain.removeHandler(name)
    )
  }

  // Constructor performs no disk or OS encryption work; first request creates the service.
  let agentProfiles = deps.agentProfiles
  const agent = (): AgentProfileService => {
    if (!agentProfiles) {
      if (!deps.agentUserDataDir) throw new TraceError(ERR.INTERNAL, '服务配置目录不可用')
      agentProfiles = new AgentProfileService(deps.agentUserDataDir, approveAgentOutbound)
    }
    return agentProfiles
  }
  reg('agent:provider:list', async () => agent().providers())
  reg('agent:profile:list', () => agent().list())
  reg('agent:profile:create', (payload) => agent().create(payload))
  reg('agent:profile:update', (payload) => agent().update(payload))
  reg('agent:profile:delete', (payload) => agent().delete(payload?.id))
  reg('agent:profile:setDefault', (payload) => agent().setDefault(payload?.id))
  reg('agent:key:set', (payload) => agent().setKey(payload?.id, payload?.key))
  reg('agent:key:remove', (payload) => agent().removeKey(payload?.id))
  reg('agent:capability:test', (payload) => agent().testCapability(payload))
  const agentTargets = deps.agentTargetService ?? new AgentTargetService(storage)
  registerAgentTargetIpc(reg, () => agentTargets)
  let agentConversations = deps.agentConversations
  const conversation = (): AgentConversationService => {
    if (!agentConversations) {
      if (!deps.agentUserDataDir) throw new TraceError(ERR.INTERNAL, '会话目录不可用')
      agentConversations = new AgentConversationService(new AgentSessionRepository(deps.agentUserDataDir), new AgentContextService(storage), async (id) => (await agent().list()).profiles.find((profile) => profile.id === id) ?? null, { credentialRevision: (id) => agent().credentialRevision(id), targets: agentTargets, tools: deps.agentToolDefinitions })
    }
    return agentConversations
  }
  registerAgentConversationIpc(reg, conversation)
  let agentPolicies = deps.agentPolicyService
  const policy = (): AgentPolicyService => {
    if (!agentPolicies) {
      if (!deps.agentUserDataDir) throw new TraceError(ERR.INTERNAL, '权限策略目录不可用')
      agentPolicies = new AgentPolicyService(deps.agentUserDataDir)
    }
    return agentPolicies
  }
  registerAgentPolicyIpc(reg, policy)
  let agentOperations: AgentOperationService | undefined
  const operations = (): AgentOperationService => {
    if (!deps.planReferences || !deps.planNameTemplates) throw new TraceError(ERR.INTERNAL, '智能体计划操作依赖未初始化')
    agentOperations ??= new AgentOperationService(conversation(), agentTargets, policy(), storage, deps.planReferences, deps.planNameTemplates)
    return agentOperations
  }
  let agentRequests: AgentRequestService | undefined
  const requests = (): AgentRequestService => {
    agentRequests ??= new AgentRequestService(conversation(), agent(), (event) => {
      const window = getWindow()
      if (!window || window.webContents.isDestroyed()) return
      window.webContents.send('trace:agent-request', event)
    }, approveAgentOutbound, deps.planReferences && deps.planNameTemplates ? operations() : undefined, (event) => {
      const window = getWindow()
      if (!window || window.webContents.isDestroyed()) return
      window.webContents.send('trace:agent-operation', event)
    })
    return agentRequests
  }
  const confirmationOwner = (): BrowserWindow | null => {
    const owner = getWindow()
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return null
    return owner
  }
  const presentOperationConfirmation: AgentOperationTrustedConfirmationPresenter = async (snapshot, accept) => {
    const owner = confirmationOwner()
    if (!owner) return
    if (deps.requestTrustedOperationConfirmation) {
      await deps.requestTrustedOperationConfirmation(snapshot, accept)
      return
    }
    await showTrustedLocalConfirmation(owner, { kind: 'agent-operation', snapshot }, accept,
      () => !owner.isDestroyed() && !owner.webContents.isDestroyed() && getWindow() === owner)
  }
  const presentTrashPurgeConfirmation = async (
    snapshot: Readonly<TrashPurgeConfirmationSnapshot>,
    accept: () => Promise<TrashOperationCommitResult>
  ): Promise<void> => {
    const owner = confirmationOwner()
    if (!owner) return
    if (deps.requestTrustedTrashPurgeConfirmation) {
      await deps.requestTrustedTrashPurgeConfirmation(snapshot, accept)
      return
    }
    await showTrustedLocalConfirmation(owner, { kind: 'trash-purge', snapshot }, accept,
      () => !owner.isDestroyed() && !owner.webContents.isDestroyed() && getWindow() === owner)
  }
  registerAgentOperationIpc(reg, operations, async (sessionId, batch: AgentOperationBatch) => {
    requests().emitOperationBatch(sessionId, batch)
    if (!batch.attemptKind && (batch.status === 'awaiting-outbound-preview' || batch.status === 'execution-failed' || batch.status === 'cancelled')) {
      try { await requests().continueAssistant(sessionId, batch.requestId) } catch { /* Keep the local tool receipt if outbound approval is declined. */ }
    }
  }, presentOperationConfirmation)
  reg('agent:request:send', (payload) => requests().send(payload))
  reg('agent:request:cancel', (payload) => requests().cancel(payload))
  reg('agent:request:continue', (payload) => requests().continueAwaitingBatch(payload))

  // ---------- app ----------
  reg('app:getAppInfo', () => app.getAppInfo())
  regRootState('app:bootstrap', async () => {
    await startup.waitForBootstrap()
    const rootActivationStatus = startup.getRootActivationStatus()
    const info = await app.bootstrap()
    if (!info.rootConfigured || rootActivationStatus === 'active') return info
    return { ...info, rootInvalid: true }
  })
  regRootState('app:setRootDir', async (p) => {
    await startup.waitForRootActivation()
    const rootActivationStatus = startup.getRootActivationStatus()
    // Onboarding after unsuccessful startup is explicit recovery consent; it only changes the
    // configured path and does not delete or migrate data from the inactive library.
    const recoverySelection = rootActivationStatus !== 'active' && p.confirmed === false
    const result = await app.setRootDir(p.dirPath, p.confirmed || recoverySelection)
    agentTargets.invalidateRoot()
    startup.markRootActivated()
    return result
  })
  reg('app:chooseDirectory', async () => {
    const r = await dialog.showOpenDialog(getWindow() ?? ({} as BrowserWindow), {
      properties: ['openDirectory', 'createDirectory']
    })
    return { dirPath: r.canceled ? null : (r.filePaths[0] ?? null) }
  })
  reg('app:pickSavePath', (p) =>
    dialog
      .showSaveDialog(getWindow() ?? ({} as BrowserWindow), {
        defaultPath: p.defaultName,
        filters: [{ name: 'Trace 计划包', extensions: p.extensions }]
      })
      .then((r) => ({ filePath: r.canceled ? null : (r.filePath ?? null) }))
  )
  reg('app:pickFiles', (p) =>
    dialog
      .showOpenDialog(getWindow() ?? ({} as BrowserWindow), {
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '文件', extensions: p.extensions }]
      })
      .then((r) => ({ files: r.canceled ? [] : r.filePaths.map((path) => ({ path, name: basename(path) })) }))
  )
  reg('app:reportError', (p) => {
    log(`renderer:${p.context}`, ERR.INTERNAL, p.message) // 渲染器上报：仅上下文与消息
    return Promise.resolve(null)
  })

  // ---------- storage ----------
  reg('storage:treeGetChildren', (p) => storage.treeGetChildren(p.parent_path))
  reg('storage:createPlan', (p) => storage.createPlan(p.parent_path, p.name))
  reg('storage:createFolder', (p) => storage.createFolder(p.parent_path, p.name))
  reg('storage:renamePlan', async () => {
    throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请通过关联影响确认流程重命名计划')
  })
  // Reject stale renderer/preload callers without touching StorageService or the filesystem.
  ipcMain.handle('storage:deletePlan', async () =>
    fail(ERR.CONFIRMATION_REQUIRED, '请通过关联影响确认流程删除计划'))
  registeredLegacyChannels.push('storage:deletePlan')
  regRootState('storage:movePlan', (p) => referenceService().commitMove(p, storage).then(() => null))
  reg('storage:readPlan', (p) => storage.readPlan(p.path))
  // Renderer document writes share the reference mutation queue and reject bypass edits to
  // currently referenced target identities/display names before the CAS write is attempted.
  regRootState('storage:savePlan', (p) => referenceService().saveRendererPlan(
    storage, p.path, p.document, p.expected_updated_at
  ))
  // Serialize the legacy single-component route with reference confirmation and verify reference
  // targets at write time, so an append waiting behind deletion cannot create a dangling link.
  regRootState('storage:appendComponent', (p) => referenceService()
    .appendRendererComponent(storage, p.path, p.component).then(() => null))
  reg('storage:removeComponent', async () => {
    throw new TraceError(ERR.CONFIRMATION_REQUIRED, '请通过关联影响确认流程删除组件')
  })
  reg('storage:moveComponent', (p) => storage.moveComponent(p.path, p.component_id, p.target_index).then(() => null))
  reg('storage:updateTask', (p) => storage.updateTask(p.path, p.component_id, p.task_id, p.patch).then(() => null))

  // ---------- plan-library trash ----------
  regRootState('trash:list', () => referenceService().listTrashEntries(storage))
  regRootState('trash:entryTarget', (p) => storage.issueTrashEntryTarget(p.entry_id))
  regRootState('trash:restore-preview', (p) => storage.previewTrashRestore(
    p.entry_id, p.destination, p.entry_target_token
  ))
  regRootState('trash:restore-commit', (p) => referenceService().commitTrashRestore(storage, p.confirmation_token))
  regRootState('trash:purge-preview', (p) => storage.previewTrashPurge(p.entry_id, p.entry_target_token))
  regRootState('trash:purge-commit', async (p) => {
    const snapshot = await storage.getTrashPurgeConfirmationSnapshot(p.confirmation_token)
    let committed: TrashOperationCommitResult | undefined
    await presentTrashPurgeConfirmation(snapshot, async () => {
      committed = await referenceService().commitTrashPurge(storage, p.confirmation_token)
      return committed
    })
    if (!committed) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '永久清除尚未获得可信确认')
    return committed
  })

  // ---------- plan-name templates (the active root is derived only in main) ----------
  const templateService = (): PlanNameTemplateService => {
    if (!deps.planNameTemplates) throw new TraceError(ERR.INTERNAL, '计划名称模板服务未初始化')
    return deps.planNameTemplates
  }
  const activePlanRoot = (): string => {
    const root = storage.getRootAbs()
    if (!root) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
    return root
  }
  regRootState('plan-template:get', () => templateService().get(activePlanRoot()))
  regRootState('plan-template:set', (p) => templateService().set(activePlanRoot(), p.parent_path, p.template))
  regRootState('plan-template:remove', (p) => templateService().remove(activePlanRoot(), p.parent_path))

  const workspaceTabsService = (): WorkspaceTabsService => {
    if (!deps.workspaceTabs) throw new TraceError(ERR.INTERNAL, '计划标签服务未初始化')
    return deps.workspaceTabs
  }
  regRootState('workspace-tabs:get', () => workspaceTabsService().load())
  regRootState('workspace-tabs:set', async (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.keys(payload).length !== 1 || !Object.hasOwn(payload, 'state')) {
      throw new TraceError(ERR.VALIDATION, '计划标签请求无效')
    }
    await workspaceTabsService().save(payload.state)
    return null
  })

  const referenceService = (): PlanReferenceService => {
    if (!deps.planReferences) throw new TraceError(ERR.INTERNAL, '引用服务未初始化')
    return deps.planReferences
  }
  const referenceRequest = <T extends Record<string, unknown>>(payload: unknown, keys: readonly string[]): T => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      Object.getPrototypeOf(payload) !== Object.prototype ||
      Object.keys(payload).some((key) => !keys.includes(key)) ||
      !keys.filter((key) => key !== 'component_id').every((key) => Object.hasOwn(payload, key))) {
      throw new TraceError(ERR.VALIDATION, '引用请求无效')
    }
    return payload as T
  }
  reg('plan-reference:search', (payload) =>
    referenceService().search(referenceRequest(payload, ['library_id', 'query'])))
  reg('plan-reference:resolve', (payload) =>
    referenceService().resolve(referenceRequest(payload, ['library_id', 'plan_id', 'component_id'])))
  regRootState('plan-reference:commitTarget', (payload) =>
    referenceService().commitTarget(referenceRequest(payload, ['library_id', 'path', 'component_id', 'mode'])))
  reg('plan-reference:inbound', (payload) =>
    referenceService().inbound(referenceRequest(payload, ['library_id', 'plan_id', 'component_id'])))
  reg('plan-reference:previewImpact', (payload) => referenceService().previewImpact(payload))
  regRootState('plan-reference:commitImpact', (payload) => referenceService().commitImpact(payload, storage))

  // ---------- window（无边框自绘控制） ----------
  reg('window:minimize', () => {
    getWindow()?.minimize()
    return Promise.resolve(null)
  })
  reg('window:toggleMaximize', () => {
    const win = getWindow()
    if (!win) return Promise.resolve({ maximized: false })
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return Promise.resolve({ maximized: win.isMaximized() })
  })
  reg('window:close', () => {
    getWindow()?.close()
    return Promise.resolve(null)
  })
  reg('window:getMaximized', () => Promise.resolve({ maximized: getWindow()?.isMaximized() ?? false }))
  reg('window:toggleDevtools', () => {
    getWindow()?.webContents.toggleDevTools()
    return Promise.resolve(null)
  })

  // ---------- config ----------
  reg('config:getWindow', () => config.getWindowState())
  reg('config:setWindow', (p) => config.saveWindowState(p).then(() => null))

  // ---------- search ----------
  reg('search:query', (p) => Promise.resolve(search.query(p.keywords)))
  reg('search:getStatus', () => Promise.resolve({ state: search.getState(), indexed: search.indexedCount }))

  // ---------- PlantUML 本地服务 ----------
  const requirePlantuml = (): PlantumlService => {
    if (!plantuml) throw new TraceError(ERR.STATE_MACHINE, 'PlantUML 服务尚未初始化')
    return plantuml
  }
  const stoppedStatus: PlantUmlStatusDto = { state: 'stopped', port: DEFAULT_PLANTUML_PORT, errorCode: null }
  const runAfterRootActivation = <T>(operation: () => T | Promise<T>): Promise<T> => {
    if (disposed) return Promise.reject(new TraceError(ERR.STATE_MACHINE, 'IPC 已关闭'))
    return startup.runAfterRootActivation(() => {
      if (disposed) throw new TraceError(ERR.STATE_MACHINE, 'IPC 已关闭')
      return operation()
    })
  }
  reg('plantuml:configure', (payload) => {
    const configuration = parsePlantumlConfiguration(payload)
    return runAfterRootActivation(() => requirePlantuml().configure(configuration))
  })
  reg('plantuml:getStatus', () => Promise.resolve(plantuml?.getStatus() ?? { ...stoppedStatus }))
  reg('plantuml:retry', () => runAfterRootActivation(() => requirePlantuml().retry()))

  // ---------- transfer ----------
  reg('transfer:exportPlan', (p) => transfer.exportPlan(p.path, p.saveTo))
  reg('transfer:exportPdf', (p) => deps.export.exportPdf(p.path, p.saveTo))
  reg('transfer:exportPng', (p) => deps.export.exportPng(p.path, p.saveTo))
  // Bundle imports write plan documents; serialize them with reference commits so an in-flight
  // import cannot change the inbound set between final impact validation and target mutation.
  regRootState('transfer:importPlan', (p) => referenceService().runRendererMutation(
    () => transfer.importPlan(p.target_parent_path, p.filePath)
  ))
  reg('transfer:importMarkdown', async (p) => {
    // 文件读取在主进程（渲染器无 fs 权限）
    const files = await Promise.all(
      p.paths.map(async (path) => ({ name: basename(path), content: await fs.readFile(path, 'utf8') }))
    )
    return transfer.importMarkdown(p.target_parent_path, files)
  })

  // ---------- diary（日记深化 2026-09-10） ----------
  // 载荷不含 planRoot：renderer 不供给路径，根由 main 自解析（先例：app 经 config.getRootDir、transfer 经 storage.getRootAbs）
  const diaryRoot = (): string => {
    const r = storage.getRootAbs()
    if (!r) throw new TraceError(ERR.INTERNAL, '计划库根目录未初始化')
    return r
  }
  reg('diary:ensure', async () => {
    // 幂等：日记根 + 今日页（模板三件套）——存在即跳过，只建不补
    const root = diaryRoot()
    const isRootActive = deps.captureDiaryRootGuard?.(root) ?? (() => storage.getRootAbs() === root)
    const today = todayDateStr()
    await ensureDiaryRoot(root)
    const { created } = await ensureTodayPageWithResult(root, today)
    if (created && isRootActive()) {
      // 前台可能抢先创建今天页，后台此时零创建；同样需要更新缓存与索引。
      storage.treeCache.invalidatePrefix(DIARY_DIR)
      bus.emit('trace:plan-changed', { path: `${DIARY_DIR}/${today}` })
    }
    return null
  })
  reg('diary:month', async (p) => ({ entries: await listMonthEntries(diaryRoot(), p.year, p.month) }))
  reg('diary:year', async (p) => ({ entries: await listYearEntries(diaryRoot(), p.year) }))
  reg('diary:day', async (p) => readDaySummary(diaryRoot(), p.date))
  reg('diary:memories', async () => listMemories(diaryRoot()))

  // ---------- 事件转发：bus → 渲染器 ----------
  const forward = <K extends keyof TraceEvents>(event: K): void => {
    const unsubscribe = bus.on(event, (payload) => {
      const window = getWindow()
      if (!window || window.webContents.isDestroyed()) return
      window.webContents.send(event, payload)
    })
    unsubscribeListeners.push(unsubscribe)
  }
  forward('trace:plan-changed')
  forward('trace:reference-target-changed')
  forward('trace:save-status')
  forward('trace:fs-external-change')
  forward('trace:index-status')
  forward('trace:diary-automation-status')

  if (plantuml) {
    const unsubscribe = plantuml.onStatus((status) => {
      const window = getWindow()
      if (!window || window.webContents.isDestroyed()) return
      window.webContents.send('trace:plantuml-status', { ...status })
    })
    unsubscribeListeners.push(unsubscribe)
  }

  return () => {
    if (disposed) return
    disposed = true
    agentRequests?.dispose()
    disposeAgentApprovalIpc?.()
    deps.agentApprovalWindowService?.dispose()
    for (const unsubscribe of unsubscribeListeners.splice(0)) unsubscribe()
    for (const channel of registeredChannels.splice(0)) ipcMain.removeHandler(channel)
    for (const channel of registeredLegacyChannels.splice(0)) ipcMain.removeHandler(channel)
  }
}

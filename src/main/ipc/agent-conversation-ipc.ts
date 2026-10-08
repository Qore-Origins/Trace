import type { ChannelName, Channels } from '../../shared/ipc-contract'
import type { AgentConversationService } from '../services/agent-conversation-service'
import type { AgentTargetService } from '../services/agent-target-service'
import type { AgentPolicyService } from '../services/agent-policy-service'
import type { AgentOperationService, AgentOperationTrustedConfirmationPresenter } from '../services/agent-operation-service'
import type { AgentOperationBatch } from '../../shared/agent-types'

type Register = <K extends ChannelName>(name: K, handler: (payload: Channels[K]['req']) => Promise<Channels[K]['res']>) => void
export function registerAgentConversationIpc(reg: Register, service: () => AgentConversationService): void {
  reg('agent:session:list', () => service().list())
  reg('agent:session:create', (payload) => service().create(payload))
  reg('agent:session:read', (payload) => service().read(payload?.id))
  reg('agent:session:update', (payload) => service().update(payload))
  reg('agent:session:delete', (payload) => service().delete(payload?.id).then(() => null))
  reg('agent:context:browse', (payload) => service().contexts.browse(payload?.parentPath))
  reg('agent:context:read', (payload) => service().contexts.read(payload))
  reg('agent:preview:create', (payload) => service().createPreview(payload))
  reg('agent:preview:cancel', async (payload) => { service().cancelPreview(payload?.token); return null })
}

export function registerAgentTargetIpc(reg: Register, service: () => AgentTargetService): void {
  reg('agent:target:grant', (payload) => service().grant(payload))
  reg('agent:target:validate', (payload) => service().validate(payload))
  reg('agent:target:children', (payload) => service().children(payload))
  reg('agent:target:release', async (payload) => service().release(payload))
}

export function registerAgentPolicyIpc(reg: Register, service: () => AgentPolicyService): void {
  reg('agent:policy:get', () => service().get())
  reg('agent:policy:set', (payload) => service().set(payload))
}

export function registerAgentOperationIpc(
  reg: Register,
  service: () => AgentOperationService,
  afterDecision: (sessionId: string, batch: AgentOperationBatch) => Promise<void>,
  presentTrustedConfirmation: AgentOperationTrustedConfirmationPresenter
): void {
  reg('agent:operation:read', (payload) => service().readBatch(payload))
  reg('agent:operation:retry', async (payload) => {
    const batch = await service().retryBatch(payload)
    await afterDecision(payload.sessionId, batch)
    return batch
  })
  reg('agent:operation:continue', async (payload) => {
    const batch = await service().continueBatch(payload)
    await afterDecision(payload.sessionId, batch)
    return batch
  })
  reg('agent:operation:undo', async (payload) => {
    const batch = await service().undoOperation(payload)
    await afterDecision(payload.sessionId, batch)
    return batch
  })
  reg('agent:operation:confirm', async (payload) => {
    const batch = await service().confirmBatch(payload, presentTrustedConfirmation)
    if (batch.status !== 'pending-confirmation') await afterDecision(payload.sessionId, batch)
    return batch
  })
  reg('agent:operation:cancel', async (payload) => {
    await service().cancelBatch(payload)
    const batch = await service().readBatch({ sessionId: payload.sessionId, batchId: payload.batchId })
    await afterDecision(payload.sessionId, batch)
    return null
  })
}

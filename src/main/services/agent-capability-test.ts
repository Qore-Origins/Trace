import type { AgentApprovalRequestSnapshot, AgentCapability } from '../../shared/agent-types'
import { ERR, TraceError } from '../../shared/errors'
import { AgentStreamError } from './agent-sse'
import { streamChatCompletion, type AgentChatMessage, type AgentProviderTool, type AgentProviderToolOptions } from './agent-provider'
import { createAgentApprovalRequestSnapshot } from './agent-approval-window-service'

const PROBE_NAME = 'trace_capability_probe'
const PROBE_VALUE = 'ready'
const PROBE_TOOL: AgentProviderTool = {
  type: 'function',
  function: {
    name: PROBE_NAME,
    description: 'Return the fixed synthetic test value.',
    parameters: { type: 'object', properties: { value: { type: 'string', enum: [PROBE_VALUE] } }, required: ['value'], additionalProperties: false }
  }
}

export interface AgentCapabilityInput { endpoint: string; model: string; apiKey: string; signal?: AbortSignal; timeoutMs?: number }

export interface AgentCapabilityRequest {
  snapshot: AgentApprovalRequestSnapshot
  messages: readonly AgentChatMessage[]
  options: AgentProviderToolOptions
}

export function createAgentCapabilityRequest(endpoint: string, model: string): AgentCapabilityRequest {
  const messages: readonly AgentChatMessage[] = Object.freeze([
    Object.freeze({ role: 'user' as const, content: 'Call the provided test function with value ready.' })
  ])
  const options: AgentProviderToolOptions = Object.freeze({ tools: Object.freeze([PROBE_TOOL]), toolChoice: PROBE_NAME })
  return Object.freeze({ snapshot: createAgentApprovalRequestSnapshot(endpoint, model, messages, options), messages, options })
}

export async function runAgentToolCapabilityTest(input: AgentCapabilityInput, request: AgentCapabilityRequest): Promise<AgentCapability> {
  const testedAt = new Date().toISOString()
  try {
    const result = await streamChatCompletion({
      ...input, messages: request.messages
    }, request.options)
    if (result.toolCalls.length !== 1 || result.toolCalls[0].name !== PROBE_NAME) return { status: 'failed', testedAt, errorCategory: 'unsupported' }
    const args = result.toolCalls[0].arguments
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || (args as Record<string, unknown>).value !== PROBE_VALUE) return { status: 'failed', testedAt, errorCategory: 'unsupported' }
    return { status: 'passed', testedAt, errorCategory: null }
  } catch (error) {
    return { status: 'failed', testedAt, errorCategory: error instanceof AgentStreamError ? error.category : 'internal' }
  }
}

export async function testAgentToolCapability(
  input: AgentCapabilityInput,
  authorizeOutbound: (snapshot: AgentApprovalRequestSnapshot) => Promise<boolean>
): Promise<AgentCapability> {
  const request = createAgentCapabilityRequest(input.endpoint, input.model)
  if (!await authorizeOutbound(request.snapshot)) throw new TraceError(ERR.CONFIRMATION_REQUIRED, '能力测试外发未获批准')
  return runAgentToolCapabilityTest(input, request)
}

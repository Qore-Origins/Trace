import type { AgentCapability } from '../../shared/agent-types'
import { AgentStreamError } from './agent-sse'
import { streamChatCompletion, type AgentProviderTool } from './agent-provider'

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

export async function testAgentToolCapability(input: AgentCapabilityInput): Promise<AgentCapability> {
  const testedAt = new Date().toISOString()
  try {
    const result = await streamChatCompletion({
      ...input, messages: [{ role: 'user', content: 'Call the provided test function with value ready.' }]
    }, { tools: [PROBE_TOOL], toolChoice: PROBE_NAME })
    if (result.toolCalls.length !== 1 || result.toolCalls[0].name !== PROBE_NAME) return { status: 'failed', testedAt, errorCategory: 'unsupported' }
    const args = result.toolCalls[0].arguments
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 || (args as Record<string, unknown>).value !== PROBE_VALUE) return { status: 'failed', testedAt, errorCategory: 'unsupported' }
    return { status: 'passed', testedAt, errorCategory: null }
  } catch (error) {
    return { status: 'failed', testedAt, errorCategory: error instanceof AgentStreamError ? error.category : 'internal' }
  }
}

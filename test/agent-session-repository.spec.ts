import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AgentSessionRepository } from '../src/main/services/agent-session-repository'

let directory: string
let repository: AgentSessionRepository
const profileId = '11111111-1111-4111-8111-111111111111'
const timestamp = '2026-10-04T00:00:00.000Z'

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'trace-agent-session-'))
  repository = new AgentSessionRepository(directory)
})
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }) })

describe('agent session tool transcript persistence', () => {
  it('persists assistant tool_calls and matching tool results as part of a completed request', async () => {
    const session = await repository.create({ title: 'Tool transcript', profileId })
    const requestId = randomUUID()
    const userId = randomUUID()
    const assistantId = randomUUID()
    await repository.mutate(session.id, (current) => {
      current.requests.push({ id: requestId, profileId, profileName: 'Local', presetId: null, model: 'synthetic', requestedAt: timestamp, sources: [], toolRounds: 1, toolCallCount: 1 })
      current.messages.push(
        { id: userId, requestId, role: 'user', content: 'Read plan.', status: 'complete', createdAt: timestamp },
        { id: assistantId, requestId, role: 'assistant', content: '', status: 'complete', createdAt: timestamp, toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{"ref":"r1"}' } }] },
        { id: randomUUID(), requestId, role: 'tool', toolCallId: 'call_1', content: '{"title":"Example"}', status: 'complete', createdAt: timestamp }
      )
    })

    const reopened = await new AgentSessionRepository(directory).read(session.id)
    expect(reopened.messages[1]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'call_1', function: { name: 'plan.read', arguments: '{"ref":"r1"}' } }] })
    expect(reopened.messages[2]).toMatchObject({ role: 'tool', toolCallId: 'call_1', content: '{"title":"Example"}' })
    expect(reopened.requests[0]).toMatchObject({ toolRounds: 1, toolCallCount: 1 })
  })

  it('continues to read Phase 1 session records with no tool fields or counters', async () => {
    const id = randomUUID()
    const requestId = randomUUID()
    const legacy = {
      schemaVersion: 1, id, title: 'Legacy', profileId, createdAt: timestamp, updatedAt: timestamp, revision: 1,
      requests: [{ id: requestId, profileId, profileName: 'Local', presetId: null, model: 'synthetic', requestedAt: timestamp, sources: [] }],
      messages: [
        { id: randomUUID(), requestId, role: 'user', content: 'Old question', status: 'complete', createdAt: timestamp },
        { id: randomUUID(), requestId, role: 'assistant', content: 'Old answer', status: 'complete', createdAt: timestamp }
      ]
    }
    await fs.mkdir(join(directory, 'agent-sessions'), { recursive: true })
    await fs.writeFile(join(directory, 'agent-sessions', `${id}.json`), JSON.stringify(legacy))

    const reopened = await new AgentSessionRepository(directory).read(id)
    expect(reopened.messages.map((message) => message.content)).toEqual(['Old question', 'Old answer'])
    expect(reopened.requests[0]).toMatchObject({ toolRounds: 0, toolCallCount: 0 })
  })

  it('rejects malformed tool arguments, duplicate call IDs, orphan results, and mismatched request counters', async () => {
    const session = await repository.create({ title: 'Invalid tool history', profileId })
    const requestId = randomUUID()
    const base = {
      schemaVersion: 1, id: session.id, title: session.title, profileId, createdAt: timestamp, updatedAt: timestamp, revision: 1,
      requests: [{ id: requestId, profileId, profileName: 'Local', presetId: null, model: 'synthetic', requestedAt: timestamp, sources: [], toolRounds: 1, toolCallCount: 1 }],
      messages: [
        { id: randomUUID(), requestId, role: 'user', content: 'Read.', status: 'complete', createdAt: timestamp },
        { id: randomUUID(), requestId, role: 'assistant', content: '', status: 'complete', createdAt: timestamp, toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{bad' } }] }
      ]
    }
    const file = join(directory, 'agent-sessions', `${session.id}.json`)
    const reopened = new AgentSessionRepository(directory)
    await fs.writeFile(file, JSON.stringify(base))
    await expect(reopened.read(session.id)).rejects.toMatchObject({ code: 14 })

    const duplicate = structuredClone(base)
    duplicate.messages[1].toolCalls.push({ id: 'call_1', type: 'function', function: { name: 'plan.read', arguments: '{}' } })
    duplicate.requests[0].toolCallCount = 2
    await fs.writeFile(file, JSON.stringify(duplicate))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })

    const orphan = structuredClone(base)
    orphan.messages[1].toolCalls[0].function.arguments = '{}'
    orphan.requests[0].toolRounds = 0
    orphan.requests[0].toolCallCount = 0
    orphan.messages.push({ id: randomUUID(), requestId, role: 'tool', toolCallId: 'orphan', content: 'unexpected', status: 'complete', createdAt: timestamp })
    await fs.writeFile(file, JSON.stringify(orphan))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
  })
})

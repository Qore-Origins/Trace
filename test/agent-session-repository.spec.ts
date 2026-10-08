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

  it('rejects incomplete or out-of-order tool results but accepts a pending result group', async () => {
    const session = await repository.create({ title: 'Ordered tool transcript', profileId })
    const requestId = randomUUID()
    const file = join(directory, 'agent-sessions', `${session.id}.json`)
    const writeTranscript = (resultIds: readonly string[]) => fs.writeFile(file, JSON.stringify({
      schemaVersion: 1, id: session.id, title: session.title, profileId, createdAt: timestamp, updatedAt: timestamp, revision: 1,
      requests: [{ id: requestId, profileId, profileName: 'Local', presetId: null, model: 'synthetic', requestedAt: timestamp, sources: [], toolRounds: 1, toolCallCount: 2 }],
      messages: [
        { id: randomUUID(), requestId, role: 'user', content: 'Read both plans.', status: 'complete', createdAt: timestamp },
        { id: randomUUID(), requestId, role: 'assistant', content: '', status: 'complete', createdAt: timestamp, toolCalls: [
          { id: 'call_first', type: 'function', function: { name: 'plan.read', arguments: '{"ref":"first"}' } },
          { id: 'call_second', type: 'function', function: { name: 'plan.read', arguments: '{"ref":"second"}' } }
        ] },
        ...resultIds.map((toolCallId) => ({ id: randomUUID(), requestId, role: 'tool', toolCallId, content: toolCallId, status: 'complete', createdAt: timestamp }))
      ]
    }))

    await writeTranscript([])
    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({ messages: [{ role: 'user' }, { role: 'assistant', toolCalls: [{ id: 'call_first' }, { id: 'call_second' }] }] })

    await writeTranscript(['call_first', 'call_second'])
    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({ messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'tool', toolCallId: 'call_first' }, { role: 'tool', toolCallId: 'call_second' }] })

    await writeTranscript(['call_second', 'call_first'])
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })

    await writeTranscript(['call_first'])
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
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

    const arrayRole = structuredClone(base)
    arrayRole.messages[0].role = ['user']
    arrayRole.messages[1].toolCalls[0].function.arguments = '{}'
    await fs.writeFile(file, JSON.stringify(arrayRole))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })

    const arrayStatus = structuredClone(base)
    arrayStatus.messages[0].status = ['complete']
    arrayStatus.messages[1].toolCalls[0].function.arguments = '{}'
    await fs.writeFile(file, JSON.stringify(arrayStatus))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
  })

  it('strictly persists and parses reconciliation-required operation outcomes', async () => {
    const session = await repository.create({ title: 'Reconciliation audit', profileId })
    const requestId = randomUUID()
    const assistantMessageId = randomUUID()
    const userMessageId = randomUUID()
    const batchId = randomUUID()
    const batch = {
      id: batchId, requestId, assistantMessageId, userMessageId, createdAt: timestamp, updatedAt: timestamp,
      policyMode: 'confirm', status: 'reconciliation-required', confirmationSource: 'user', requiredConfirmation: true,
      operations: [{
        callId: 'audit_uncertain_call', operation: 'component.update', status: 'outcome-unknown',
        libraryId: 'a'.repeat(32), rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [],
        requiredConfirmation: true, confirmationSource: 'user', reversible: true, undoStatus: 'unavailable', errorCategory: 'storage',
        reconciliationReason: 'success-audit-persistence-failed', createdAt: timestamp, completedAt: timestamp
      }]
    }
    await repository.mutate(session.id, (current) => {
      current.operationBatches.push(batch as unknown as typeof current.operationBatches[number])
    })
    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({
      operationBatches: [{ status: 'reconciliation-required', operations: [{
        status: 'outcome-unknown', reconciliationReason: 'success-audit-persistence-failed'
      }] }]
    })

    const file = join(directory, 'agent-sessions', `${session.id}.json`)
    const persisted = JSON.parse(await fs.readFile(file, 'utf8')) as { operationBatches: Array<Record<string, unknown>> }
    const postSideEffectOutcome = structuredClone(persisted)
    const postSideEffectOperations = postSideEffectOutcome.operationBatches[0].operations as Array<Record<string, unknown>>
    postSideEffectOperations[0].reconciliationReason = 'post-side-effect-verification-failed'
    await fs.writeFile(file, JSON.stringify(postSideEffectOutcome))
    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({
      operationBatches: [{ status: 'reconciliation-required', operations: [{ reconciliationReason: 'post-side-effect-verification-failed' }] }]
    })

    persisted.operationBatches[0].operations = [{
      ...(persisted.operationBatches[0].operations as Array<Record<string, unknown>>)[0],
      reconciliationReason: 'absolute-path-or-private-content'
    }]
    await fs.writeFile(file, JSON.stringify(persisted))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
  })

  it('rejects malformed operation lifecycle enums, attempt lineage, and undo availability', async () => {
    const session = await repository.create({ title: 'Invalid operation lifecycle', profileId })
    const requestId = randomUUID()
    const batchId = randomUUID()
    const operationBatch = {
      id: batchId, requestId, assistantMessageId: randomUUID(), userMessageId: randomUUID(),
      createdAt: timestamp, updatedAt: timestamp, policyMode: 'confirm', status: 'execution-failed',
      confirmationSource: 'user', requiredConfirmation: true,
      operations: [{
        callId: 'failed_operation', operation: 'plan.create', status: 'failed', libraryId: 'a'.repeat(32),
        rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
        confirmationSource: 'user', reversible: true, undoStatus: 'unavailable', errorCategory: 'storage',
        createdAt: timestamp, completedAt: timestamp
      }]
    }
    await repository.mutate(session.id, (current) => {
      current.operationBatches.push(operationBatch as unknown as typeof current.operationBatches[number])
    })
    const file = join(directory, 'agent-sessions', `${session.id}.json`)
    const valid = JSON.parse(await fs.readFile(file, 'utf8')) as {
      operationBatches: Array<Record<string, unknown> & { operations: Array<Record<string, unknown>> }>
    }

    const invalidRecords: Array<(record: typeof valid) => void> = [
      (record) => { record.operationBatches[0].policyMode = ['confirm'] },
      (record) => { record.operationBatches[0].status = ['execution-failed'] },
      (record) => { record.operationBatches[0].operations[0].status = ['failed'] },
      (record) => { record.operationBatches[0].attemptOf = randomUUID() },
      (record) => { record.operationBatches[0].attemptKind = 'retry' },
      (record) => { record.operationBatches[0].operations[0].undoStatus = 'available' },
      (record) => {
        record.operationBatches[0].status = 'reconciliation-required'
      },
      (record) => {
        record.operationBatches[0].status = 'completed'
        record.operationBatches[0].operations[0].status = 'outcome-unknown'
        record.operationBatches[0].operations[0].reconciliationReason = 'success-audit-persistence-failed'
      },
      (record) => {
        const batch = record.operationBatches[0]
        const unknown = batch.operations[0]
        batch.status = 'reconciliation-required'
        unknown.status = 'outcome-unknown'
        unknown.errorCategory = 'storage'
        unknown.undoStatus = 'unavailable'
        unknown.reconciliationReason = 'post-side-effect-verification-failed'
        delete unknown.completedAt
      },
      (record) => {
        const batch = record.operationBatches[0]
        const unknown = batch.operations[0]
        batch.status = 'reconciliation-required'
        unknown.status = 'outcome-unknown'
        unknown.errorCategory = 'storage'
        unknown.undoStatus = 'unavailable'
        unknown.reconciliationReason = 'post-side-effect-verification-failed'
        unknown.completedAt = timestamp
        unknown.resolvedByAttempt = randomUUID()
      },
      (record) => {
        const batch = record.operationBatches[0]
        const unknown = batch.operations[0]
        batch.status = 'reconciliation-required'
        unknown.status = 'outcome-unknown'
        unknown.errorCategory = 'storage'
        unknown.undoStatus = 'unavailable'
        unknown.reconciliationReason = 'post-side-effect-verification-failed'
        unknown.completedAt = timestamp
        batch.operations.push({ ...unknown, callId: 'ready_after_unknown', status: 'ready', reconciliationReason: undefined,
          errorCategory: undefined, completedAt: undefined })
      },
      (record) => {
        const batch = record.operationBatches[0]
        const unknown = batch.operations[0]
        batch.status = 'execution-failed'
        unknown.status = 'outcome-unknown'
        unknown.errorCategory = 'storage'
        unknown.undoStatus = 'unavailable'
        unknown.reconciliationReason = 'post-side-effect-verification-failed'
        unknown.completedAt = timestamp
        batch.operations.push({ ...unknown, callId: 'second_unknown_outcome' })
      },
      (record) => {
        const batch = record.operationBatches[0]
        const operation = batch.operations[0]
        batch.status = 'pending-confirmation'
        operation.status = 'succeeded'
        operation.undoStatus = 'available'
        delete operation.errorCategory
      },
      (record) => {
        const batch = record.operationBatches[0]
        const operation = batch.operations[0]
        batch.status = 'completed'
        operation.status = 'ready'
        operation.undoStatus = 'unavailable'
        delete operation.errorCategory
        delete operation.completedAt
      },
      (record) => {
        const batch = record.operationBatches[0]
        const operation = batch.operations[0]
        batch.status = 'execution-failed'
        operation.status = 'succeeded'
        operation.undoStatus = 'available'
        delete operation.errorCategory
      },
      (record) => {
        const batch = record.operationBatches[0]
        batch.attemptOf = batch.id
        batch.attemptKind = 'retry'
      },
      (record) => {
        record.operationBatches[0].attemptOf = randomUUID()
        record.operationBatches[0].attemptKind = 'retry'
      }
    ]

    for (const mutateRecord of invalidRecords) {
      const invalid = structuredClone(valid)
      mutateRecord(invalid)
      await fs.writeFile(file, JSON.stringify(invalid))
      await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
    }
  })

  it('rejects cyclic and future operation attempt ancestors', async () => {
    const session = await repository.create({ title: 'Invalid attempt ancestry', profileId })
    const requestId = randomUUID()
    const rootId = randomUUID()
    const childId = randomUUID()
    const makeBatch = (id: string, attemptOf?: string) => ({
      id, requestId, assistantMessageId: randomUUID(), userMessageId: randomUUID(),
      createdAt: timestamp, updatedAt: timestamp, policyMode: 'confirm', status: 'execution-failed',
      confirmationSource: 'user', requiredConfirmation: true,
      ...(attemptOf ? { attemptOf, attemptKind: 'retry' } : {}),
      operations: [{
        callId: 'ancestry_call', operation: 'plan.create', status: 'failed', libraryId: 'a'.repeat(32),
        rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
        confirmationSource: 'user', reversible: true, undoStatus: 'unavailable', errorCategory: 'storage',
        createdAt: timestamp, completedAt: timestamp
      }]
    })
    const file = join(directory, 'agent-sessions', `${session.id}.json`)
    await repository.mutate(session.id, (current) => {
      current.operationBatches.push(makeBatch(rootId) as unknown as typeof current.operationBatches[number])
    })
    const valid = JSON.parse(await fs.readFile(file, 'utf8')) as {
      operationBatches: Array<Record<string, unknown>>
    }

    const futureParent = structuredClone(valid)
    futureParent.operationBatches = [makeBatch(childId, rootId), makeBatch(rootId)]
    await fs.writeFile(file, JSON.stringify(futureParent))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })

    const cycle = structuredClone(valid)
    cycle.operationBatches = [makeBatch(rootId, childId), makeBatch(childId, rootId)]
    await fs.writeFile(file, JSON.stringify(cycle))
    await expect(new AgentSessionRepository(directory).read(session.id)).rejects.toMatchObject({ code: 14 })
  })

  it('marks the first possibly executed operation for manual verification after a crash', async () => {
    const session = await repository.create({ title: 'Executing crash prefix', profileId })
    const requestId = randomUUID()
    const batch = {
      id: randomUUID(), requestId, assistantMessageId: randomUUID(), userMessageId: randomUUID(),
      createdAt: timestamp, updatedAt: timestamp, policyMode: 'confirm', status: 'executing',
      confirmationSource: 'user', requiredConfirmation: true,
      operations: [
        {
          callId: 'completed_prefix', operation: 'plan.create', status: 'succeeded', libraryId: 'a'.repeat(32),
          rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
          confirmationSource: 'user', reversible: true, undoStatus: 'available', createdAt: timestamp, completedAt: timestamp
        },
        {
          callId: 'pending_suffix', operation: 'folder.create', status: 'ready', libraryId: 'a'.repeat(32),
          rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
          confirmationSource: 'none', reversible: true, undoStatus: 'unavailable', createdAt: timestamp
        },
        {
          callId: 'untouched_suffix', operation: 'folder.create', status: 'ready', libraryId: 'a'.repeat(32),
          rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
          confirmationSource: 'none', reversible: true, undoStatus: 'unavailable', createdAt: timestamp
        }
      ]
    }
    await repository.mutate(session.id, (current) => {
      current.operationBatches.push(batch as unknown as typeof current.operationBatches[number])
    })

    const reloaded = await new AgentSessionRepository(directory).read(session.id)
    expect(reloaded.operationBatches).toMatchObject([{
      status: 'reconciliation-required', operations: [
        { status: 'succeeded' },
        { status: 'outcome-unknown', reconciliationReason: 'process-interrupted', errorCategory: 'storage', undoStatus: 'unavailable' },
        { status: 'not-executed', confirmationSource: 'none' }
      ]
    }])
    expect(reloaded.operationBatches[0].operations[1].completedAt).toBeDefined()

    const persisted = JSON.parse(await fs.readFile(join(directory, 'agent-sessions', `${session.id}.json`), 'utf8')) as {
      operationBatches: Array<{ status: string; operations: Array<{ status: string }> }>
    }
    expect(persisted.operationBatches[0]).toMatchObject({
      status: 'reconciliation-required', operations: [{ status: 'succeeded' }, { status: 'outcome-unknown' }, { status: 'not-executed' }]
    })
    const revision = reloaded.revision
    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({ revision })
  })

  it('moves a fully audited executing batch to outbound preview after a crash', async () => {
    const session = await repository.create({ title: 'Fully audited batch', profileId })
    const batch = {
      id: randomUUID(), requestId: randomUUID(), assistantMessageId: randomUUID(), userMessageId: randomUUID(),
      createdAt: timestamp, updatedAt: timestamp, policyMode: 'confirm', status: 'executing',
      confirmationSource: 'user', requiredConfirmation: true,
      operations: [{
        callId: 'fully_audited', operation: 'plan.create', status: 'succeeded', libraryId: 'a'.repeat(32),
        rootHash: 'b'.repeat(64), rootGeneration: 0, changes: [], requiredConfirmation: true,
        confirmationSource: 'user', reversible: true, undoStatus: 'available', createdAt: timestamp, completedAt: timestamp
      }]
    }
    await repository.mutate(session.id, (current) => {
      current.operationBatches.push(batch as unknown as typeof current.operationBatches[number])
    })

    await expect(new AgentSessionRepository(directory).read(session.id)).resolves.toMatchObject({
      operationBatches: [{ status: 'awaiting-outbound-preview', operations: [{ status: 'succeeded' }] }]
    })
  })
})

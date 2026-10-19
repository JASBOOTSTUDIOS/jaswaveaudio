/**
 * npx tsx --test src/lib/agent-run-store.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearActiveAgentRun,
  getActiveAgentRun,
  saveAgentRunFromResult,
  patchActiveAgentRun,
  toResumePayload,
} from './agent-run-store'
import type { AgentRunResult } from '@jaswave/ai-harness'

describe('agent-run-store', () => {
  it('guarda y reanuda pendingCalls sin perder el run', () => {
    clearActiveAgentRun()
    const result = {
      status: 'waiting-for-confirmation',
      summary: 'propuesta',
      iterations: 1,
      results: [],
      decisions: [],
      pendingCalls: [{ id: 'c1', tool: 'project.setBpm', arguments: { bpm: 80 } }],
      lastObservation: { fingerprint: 'abc', text: '', relevantTrackIds: [] },
    } as unknown as AgentRunResult

    const saved = saveAgentRunFromResult(result, {
      userText: 'baja el tempo',
      conversationId: 'conv1',
      messageId: 'msg1',
    })
    assert.equal(getActiveAgentRun()?.runId, saved.runId)
    assert.equal(getActiveAgentRun()?.pendingCalls.length, 1)

    patchActiveAgentRun({ pendingCalls: [], status: 'executing' })
    const resume = toResumePayload(getActiveAgentRun()!)
    assert.equal(resume.pendingCalls.length, 0)
    assert.equal(resume.fingerprint, 'abc')
    clearActiveAgentRun()
    assert.equal(getActiveAgentRun(), null)
  })
})

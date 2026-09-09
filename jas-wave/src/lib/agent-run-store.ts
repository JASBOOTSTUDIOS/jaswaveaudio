/**
 * Persistencia en memoria de AgentRun (sobrevive a waiting-for-confirmation).
 * No es el store global del DAW.
 */

import type { AgentDecision, AgentLoopToolCall, AgentLoopToolResult, AgentRunResult } from '@jaswave/ai-harness'

export type PersistedAgentRun = {
  runId: string
  status: AgentRunResult['status']
  iteration: number
  stateRevision: string
  pendingCalls: AgentLoopToolCall[]
  results: AgentLoopToolResult[]
  decisions: AgentDecision[]
  userText: string
  conversationId: string
  messageId: string
  summary: string
}

let current: PersistedAgentRun | null = null

export function getActiveAgentRun(): PersistedAgentRun | null {
  return current
}

export function clearActiveAgentRun(): void {
  current = null
}

export function saveAgentRunFromResult(
  result: AgentRunResult,
  meta: { userText: string; conversationId: string; messageId: string; runId?: string },
): PersistedAgentRun {
  const run: PersistedAgentRun = {
    runId: meta.runId ?? `run-${Date.now().toString(36)}`,
    status: result.status,
    iteration: result.iterations,
    stateRevision: result.lastObservation?.fingerprint ?? '',
    pendingCalls: result.pendingCalls ?? [],
    results: result.results,
    decisions: result.decisions,
    userText: meta.userText,
    conversationId: meta.conversationId,
    messageId: meta.messageId,
    summary: result.summary,
  }
  current = run
  return run
}

export function patchActiveAgentRun(patch: Partial<PersistedAgentRun>): PersistedAgentRun | null {
  if (!current) return null
  current = { ...current, ...patch }
  return current
}

export function toResumePayload(run: PersistedAgentRun): {
  pendingCalls: AgentLoopToolCall[]
  results: AgentLoopToolResult[]
  iterations: number
  fingerprint: string
  decisions: AgentDecision[]
} {
  return {
    pendingCalls: run.pendingCalls,
    results: run.results,
    iterations: run.iteration,
    fingerprint: run.stateRevision,
    decisions: run.decisions,
  }
}

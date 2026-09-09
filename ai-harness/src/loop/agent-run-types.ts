/** Alineado con HARNESS_MAX_OUTER_LOOPS (until-plan). */
export const AGENT_LOOP_MAX_ITERATIONS = 8

/** Tope de <<<READ>>> por fase de razonamiento — lotes pequeños en el loop. */
export const AGENT_LOOP_MAX_TOOLS_PER_ITERATION = 4

export const AGENT_LOOP_LIMITS = {
  maxIterations: AGENT_LOOP_MAX_ITERATIONS,
  maxToolCallsPerIteration: AGENT_LOOP_MAX_TOOLS_PER_ITERATION,
  maxTotalToolCalls: AGENT_LOOP_MAX_ITERATIONS * AGENT_LOOP_MAX_TOOLS_PER_ITERATION,
} as const

export type AgentExecutionLimits = {
  maxIterations: number
  maxToolCallsPerIteration: number
  maxTotalToolCalls: number
}

export type AgentRunStatus =
  | 'idle'
  | 'observing'
  | 'planning'
  | 'validating'
  | 'executing'
  | 'observing-result'
  | 'deciding'
  | 'waiting-for-confirmation'
  | 'waiting-for-user'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentLoopToolCall = {
  id: string
  tool: string
  arguments: Record<string, unknown>
}

export type AgentLoopToolResult = {
  callId: string
  tool: string
  status: 'success' | 'error' | 'rejected' | 'cancelled'
  data?: unknown
  error?: { code: string; message: string }
  stateRevision?: string | number
}

export type AgentDecision =
  | { type: 'tool-calls'; calls: AgentLoopToolCall[] }
  | { type: 'request-confirmation'; message: string; calls: AgentLoopToolCall[] }
  | { type: 'request-user-input'; message: string }
  | { type: 'replan'; reason: string }
  | { type: 'complete'; summary: string }
  | { type: 'fail'; reason: string }

export type AgentObservation = {
  text: string
  fingerprint: string
  selectedTrackId?: string | null
  lastResults: AgentLoopToolResult[]
  intent: AgentObserveIntent
}

export type AgentObserveIntent = 'selection' | 'mix' | 'clip' | 'project'

export type AgentRunEventName =
  | 'ia.runIniciado'
  | 'ia.runEstado'
  | 'ia.herramientaSolicitada'
  | 'ia.herramientaEjecutada'
  | 'ia.herramientaFallida'
  | 'ia.runCompletado'
  | 'ia.runCancelado'

export type AgentRunResult = {
  status: AgentRunStatus
  summary: string
  iterations: number
  results: AgentLoopToolResult[]
  pendingCalls?: AgentLoopToolCall[]
  lastObservation?: AgentObservation
  decisions: AgentDecision[]
}

export type AgentLoopResume = {
  pendingCalls: AgentLoopToolCall[]
  results: AgentLoopToolResult[]
  iterations: number
  fingerprint: string
  decisions: AgentDecision[]
}

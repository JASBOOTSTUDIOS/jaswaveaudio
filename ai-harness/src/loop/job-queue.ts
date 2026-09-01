/**
 * Cola de jobs del agente persistente (sin Electron/React).
 */

import type { PlanEvaluation } from '../plan/types'
import { planHasOpenTasks } from '../plan/tasks'

export type AgentJobKind = 'certify' | 'harness-until-plan' | 'custom'

export type AgentJob = {
  id: string
  kind: AgentJobKind
  projectId: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  createdAt: number
  error?: string
}

export type AgentJobRunner = (job: AgentJob, signal: AbortSignal) => Promise<void>

export type PlanMarkdownResolver = (projectId: string) => string | null | undefined

export type AgentJobQueueStore = {
  queue: AgentJob[]
  running: AgentJob | null
  runner: AgentJobRunner | null
  abort: AbortController | null
  listeners: Set<() => void>
  resolvePlanMarkdown?: PlanMarkdownResolver
}

export function createAgentJobQueueStore(): AgentJobQueueStore {
  return {
    queue: [],
    running: null,
    runner: null,
    abort: null,
    listeners: new Set(),
  }
}

function emit(store: AgentJobQueueStore): void {
  for (const l of store.listeners) l()
}

export function subscribeAgentJobs(store: AgentJobQueueStore, fn: () => void): () => void {
  store.listeners.add(fn)
  return () => store.listeners.delete(fn)
}

export function getAgentJobState(store: AgentJobQueueStore): { queue: AgentJob[]; running: AgentJob | null } {
  return { queue: [...store.queue], running: store.running }
}

export function registerAgentJobRunner(store: AgentJobQueueStore, runner: AgentJobRunner): void {
  store.runner = runner
}

export function setPlanMarkdownResolver(store: AgentJobQueueStore, resolver: PlanMarkdownResolver): void {
  store.resolvePlanMarkdown = resolver
}

export function enqueueAgentJob(store: AgentJobQueueStore, kind: AgentJobKind, projectId: string): AgentJob {
  const job: AgentJob = {
    id: crypto.randomUUID(),
    kind,
    projectId,
    status: 'queued',
    createdAt: Date.now(),
  }
  store.queue.push(job)
  emit(store)
  void drainAgentJobQueue(store)
  return job
}

export function cancelAgentJobs(store: AgentJobQueueStore): void {
  store.abort?.abort()
  store.queue = []
  if (store.running) store.running.status = 'cancelled'
  store.running = null
  emit(store)
}

export function planHasPendingTasks(
  store: AgentJobQueueStore,
  projectId: string,
  planMarkdown?: string | null,
): boolean {
  const md = planMarkdown ?? store.resolvePlanMarkdown?.(projectId) ?? null
  return planHasOpenTasks(md)
}

export async function drainAgentJobQueue(store: AgentJobQueueStore): Promise<void> {
  if (store.running || !store.runner) return
  const next = store.queue.shift()
  if (!next) return
  store.running = next
  next.status = 'running'
  store.abort = new AbortController()
  emit(store)
  try {
    await store.runner(next, store.abort.signal)
    next.status = 'done'
  } catch (e) {
    next.status = 'failed'
    next.error = e instanceof Error ? e.message : String(e)
  } finally {
    store.running = null
    store.abort = null
    emit(store)
    if (store.queue.length) void drainAgentJobQueue(store)
  }
}

export function shouldContinueHarness(
  evaluation: PlanEvaluation | null,
  planMarkdown?: string | null,
): boolean {
  if (evaluation) return evaluation.missing.length > 0
  return planHasOpenTasks(planMarkdown)
}

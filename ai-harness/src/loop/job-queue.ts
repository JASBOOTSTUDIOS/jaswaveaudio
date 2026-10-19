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
  /**
   * Época: se incrementa en cada cancelación. Un runner abortado que termina tarde
   * compara su época y no pisa el estado del job nuevo.
   */
  epoch: number
  /** true mientras un drain está activo (drain exclusivo: nunca dos a la vez). */
  draining: boolean
}

export function createAgentJobQueueStore(): AgentJobQueueStore {
  return {
    queue: [],
    running: null,
    runner: null,
    abort: null,
    listeners: new Set(),
    epoch: 0,
    draining: false,
  }
}

function emit(store: AgentJobQueueStore): void {
  for (const l of [...store.listeners]) {
    try {
      l()
    } catch {
      /* un listener roto no debe tumbar la cola */
    }
  }
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
  store.epoch += 1
  store.abort?.abort()
  store.abort = null
  for (const j of store.queue) j.status = 'cancelled'
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
  // Drain exclusivo: si ya hay uno activo (o un job corriendo), ese drain recogerá la cola.
  if (store.draining || store.running || !store.runner) return
  store.draining = true
  try {
    for (;;) {
      if (store.running || !store.runner) return
      const next = store.queue.shift()
      if (!next) return
      const epoch = store.epoch
      const controller = new AbortController()
      store.running = next
      store.abort = controller
      next.status = 'running'
      emit(store)
      try {
        await store.runner(next, controller.signal)
        if (next.status === 'running') next.status = controller.signal.aborted ? 'cancelled' : 'done'
      } catch (e) {
        if (next.status === 'running') {
          if (controller.signal.aborted) {
            next.status = 'cancelled'
          } else {
            next.status = 'failed'
            next.error = e instanceof Error ? e.message : String(e)
          }
        }
      } finally {
        // Solo limpiar si seguimos siendo el job vigente (no hubo cancel + job nuevo).
        if (store.epoch === epoch && store.running === next) {
          store.running = null
          store.abort = null
        } else if (store.running === next) {
          store.running = null
        }
        emit(store)
      }
    }
  } finally {
    store.draining = false
    if (store.queue.length && !store.running) void drainAgentJobQueue(store)
  }
}

export function shouldContinueHarness(
  evaluation: PlanEvaluation | null,
  planMarkdown?: string | null,
): boolean {
  if (evaluation) return evaluation.missing.length > 0
  return planHasOpenTasks(planMarkdown)
}

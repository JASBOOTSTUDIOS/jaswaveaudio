/**
 * Cola de jobs para agente persistente — adaptador jas-wave → @jaswave/ai-harness.
 */

import {
  cancelAgentJobs as cancelJobsCore,
  createAgentJobQueueStore,
  enqueueAgentJob as enqueueJobCore,
  getAgentJobState as getJobStateCore,
  planHasPendingTasks as planPendingCore,
  registerAgentJobRunner as registerRunnerCore,
  setPlanMarkdownResolver,
  shouldContinueHarness as shouldContinueCore,
  subscribeAgentJobs as subscribeCore,
  type AgentJob,
  type AgentJobKind,
  type AgentJobRunner,
  type PlanEvaluation,
} from '@jaswave/ai-harness'
import { getAgentDoc, PLAN_SLUG } from './agent-docs'

export type { AgentJob, AgentJobKind, AgentJobRunner }

const g = globalThis as unknown as {
  __jaswaveAgentJobStore?: ReturnType<typeof createAgentJobQueueStore>
}

function store() {
  if (!g.__jaswaveAgentJobStore) {
    g.__jaswaveAgentJobStore = createAgentJobQueueStore()
    setPlanMarkdownResolver(g.__jaswaveAgentJobStore, (projectId) => getAgentDoc(projectId, PLAN_SLUG)?.content)
  }
  return g.__jaswaveAgentJobStore
}

export function subscribeAgentJobs(fn: () => void): () => void {
  return subscribeCore(store(), fn)
}

export function getAgentJobState(): { queue: AgentJob[]; running: AgentJob | null } {
  return getJobStateCore(store())
}

export function registerAgentJobRunner(runner: AgentJobRunner): void {
  registerRunnerCore(store(), runner)
}

export function enqueueAgentJob(kind: AgentJobKind, projectId: string): AgentJob {
  return enqueueJobCore(store(), kind, projectId)
}

export function cancelAgentJobs(): void {
  cancelJobsCore(store())
}

export function planHasPendingTasks(projectId: string): boolean {
  return planPendingCore(store(), projectId)
}

export function shouldContinueHarness(projectId: string, evaluation: PlanEvaluation | null): boolean {
  const md = getAgentDoc(projectId, PLAN_SLUG)?.content
  return shouldContinueCore(evaluation, md)
}

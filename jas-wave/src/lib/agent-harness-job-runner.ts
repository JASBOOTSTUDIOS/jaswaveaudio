/**
 * Runner persistente harness-until-plan — adaptador jas-wave → @jaswave/ai-harness/loop.
 */

import {
  createHarnessJobContextStore,
  peekHarnessJobContext,
  runHarnessUntilPlanComplete as runHarnessUntilPlanCompleteCore,
  stashHarnessJobContext as stashHarnessJobContextCore,
  type HarnessJobContext,
  type PlanEvaluation,
} from '@jaswave/ai-harness'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DAWState } from '../../../shared/src/types/state'
import { buildHarnessHealthContext } from './agent-audit-bridge'
import { runPostTurnCertifyPipeline } from './agent-certify-pipeline'
import { planHasPendingTasks, shouldContinueHarness } from './agent-job-queue'
import { getAgentDoc, PLAN_SLUG } from './agent-docs'
import { syncPlanAfterDawChange } from './agent-plan-eval'
import type { ActionResult, DawAction } from './ai-daw-agent'

export type { HarnessJobContext }

export type HarnessJobRunnerDeps = {
  dawStore: TiendaDAW
  chat: (userContent: string) => Promise<{ success: boolean; content?: string }>
  parseActions: (raw: string) => DawAction[]
  execute: (actions: DawAction[]) => Promise<ActionResult[]>
  formatResults: (results: ActionResult[]) => string
  buildSystemPrompt: (state: DAWState, userText: string) => string
  onProgress?: (phase: string) => void
  afterHarnessTurn?: (results: ActionResult[], raw?: string) => PlanEvaluation | null
}

const jobCtxStore = createHarnessJobContextStore()

export function stashHarnessJobContext(ctx: HarnessJobContext | null): void {
  stashHarnessJobContextCore(jobCtxStore, ctx)
}

export async function runHarnessUntilPlanComplete(
  deps: HarnessJobRunnerDeps,
  signal: AbortSignal,
): Promise<void> {
  const projectId = deps.dawStore.obtenerEstado().project.id
  const jobCtx = peekHarnessJobContext(jobCtxStore)

  await runHarnessUntilPlanCompleteCore(
    {
      projectId,
      getState: () => deps.dawStore.obtenerEstado(),
      getPlanMarkdown: () => getAgentDoc(projectId, PLAN_SLUG)?.content,
      syncPlanEvaluation: () => syncPlanAfterDawChange(projectId, deps.dawStore.obtenerEstado()),
      certifyTurn: async (results) => {
        const sidechainApplied = results.some((r) => r.type === 'sidechain.connect' && r.success)
        const certify = await runPostTurnCertifyPipeline(deps.dawStore, results, { sidechainApplied })
        return { planEval: certify.planEval }
      },
      chat: async (userContent) => {
        if (signal.aborted) return { success: false, content: '' }
        void deps.buildSystemPrompt(deps.dawStore.obtenerEstado(), userContent)
        return deps.chat(userContent)
      },
      parseActions: deps.parseActions,
      execute: deps.execute,
      formatResults: deps.formatResults,
      getHealthContext: async (results) => {
        const sidechainApplied = results.some((r) => r.type === 'sidechain.connect' && r.success)
        return buildHarnessHealthContext(deps.dawStore, { sidechainApplied })
      },
      onProgress: deps.onProgress,
      afterHarnessTurn: deps.afterHarnessTurn,
      planHasPending: () => planHasPendingTasks(projectId),
      shouldContinue: (evaluation) => shouldContinueHarness(projectId, evaluation),
    },
    signal,
    jobCtx,
  )

  stashHarnessJobContextCore(jobCtxStore, null)
}

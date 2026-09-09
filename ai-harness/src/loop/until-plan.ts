/**
 * Bucle persistente harness-until-plan (inyección de dependencias; sin Electron).
 */

import type { PlanEvaluation } from '../plan/types'
import type { HarnessHealthContext } from './harness'
import { runHarnessFollowups, type ActionResult, type DawAction } from './harness'

export type HarnessJobContext = {
  userText: string
  initialResults: ActionResult[]
  evaluation: PlanEvaluation | null
  actionsSummary: string
  conversationId?: string
  messageId?: string
}

export type HarnessUntilPlanDeps = {
  projectId: string
  getState: () => import('@jaswave/shared').DAWState
  getPlanMarkdown: () => string | null | undefined
  syncPlanEvaluation: () => PlanEvaluation | null
  certifyTurn: (results: ActionResult[]) => Promise<{ planEval: PlanEvaluation | null }>
  chat: (userContent: string) => Promise<{ success: boolean; content?: string }>
  parseActions: (raw: string) => DawAction[]
  execute: (actions: DawAction[]) => Promise<ActionResult[]>
  formatResults: (results: ActionResult[]) => string
  getHealthContext: (results: ActionResult[]) => Promise<HarnessHealthContext | undefined>
  onProgress?: (phase: string) => void
  afterHarnessTurn?: (results: ActionResult[], raw?: string) => PlanEvaluation | null
  planHasPending?: () => boolean
  shouldContinue?: (evaluation: PlanEvaluation | null) => boolean
}

const MAX_OUTER_LOOPS = 8

export const HARNESS_MAX_OUTER_LOOPS = MAX_OUTER_LOOPS

export function createHarnessJobContextStore(): { current: HarnessJobContext | null } {
  return { current: null }
}

export function stashHarnessJobContext(
  store: { current: HarnessJobContext | null },
  ctx: HarnessJobContext | null,
): void {
  store.current = ctx
}

export function peekHarnessJobContext(store: { current: HarnessJobContext | null }): HarnessJobContext | null {
  return store.current
}

export async function runHarnessUntilPlanComplete(
  deps: HarnessUntilPlanDeps,
  signal: AbortSignal,
  jobCtx: HarnessJobContext | null,
): Promise<void> {
  const pending = deps.planHasPending ?? (() => false)
  const shouldContinue =
    deps.shouldContinue ??
    ((evaluation: PlanEvaluation | null) => {
      if (evaluation) return evaluation.missing.length > 0
      return false
    })

  let userText = jobCtx?.userText ?? 'Completar plan.md pendiente'
  let lastResults = jobCtx?.initialResults ?? []
  let evaluation = jobCtx?.evaluation ?? deps.syncPlanEvaluation()
  let actionsSummary = jobCtx?.actionsSummary ?? ''

  for (let outer = 0; outer < MAX_OUTER_LOOPS; outer++) {
    if (signal.aborted) return
    if (!pending()) {
      const certify = await deps.certifyTurn(lastResults)
      if (!shouldContinue(certify.planEval)) break
      evaluation = certify.planEval
    }

    deps.onProgress?.(`Harness persistente (${outer + 1}/${MAX_OUTER_LOOPS})…`)

    const follow = await runHarnessFollowups({
      userText,
      initialResults: lastResults,
      evaluation,
      actionsSummary,
      projectId: deps.projectId,
      abort: signal,
      chat: deps.chat,
      parseActions: deps.parseActions,
      execute: deps.execute,
      getState: deps.getState,
      getHealthContext: () => deps.getHealthContext(lastResults),
      afterTurn: deps.afterHarnessTurn,
      formatResults: deps.formatResults,
      onProgress: ({ turn, maxTurns, report }) => {
        deps.onProgress?.(`Reparación ${turn}/${maxTurns}: ${report.errors[0]?.message ?? 'revisando'}`)
      },
    })

    lastResults = follow.results
    evaluation = follow.evaluation
    actionsSummary = follow.actionsSummary
    userText = [userText, follow.text].filter(Boolean).join('\n')

    const certify = await deps.certifyTurn(lastResults)
    evaluation = certify.planEval ?? evaluation

    if (signal.aborted) return
    if (!pending() && !shouldContinue(evaluation)) {
      deps.onProgress?.('Plan completo.')
      break
    }
    if (follow.stoppedReason === 'healthy' && !pending()) break
  }
}

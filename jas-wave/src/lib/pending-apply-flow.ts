/**
 * Flujo Aplicar de la tarjeta pendiente: ejecuta, consejo dialoga, reanaliza y propone el siguiente paso.
 */

import type { ReasoningChatTurn } from '@jaswave/ai-harness'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import {
  executeDawActions,
  formatActionResultsForUser,
  type DawAction,
} from './ai-daw-agent'
import {
  applyPendingAgentRun,
  clearActiveAgentRun,
  getActiveAgentRun,
  invalidateAgentRunForMessage,
  pendingCallsToDawActions,
  runCoproducerAgentLoop,
} from './agent-loop-bridge'
import { isProjectWipeIntent, type AgentMode } from './ai-modes'
import { withAplicarTrue } from './ai-action-policy'
import { ensureWipeProjectAction } from './project-wipe'
import { appendAiDawAudit } from './ai-daw-audit-store'
import type { StoredReasoningStep } from './agent-reasoning-bridge'

export type ApplyPendingFlowResult = {
  ok: boolean
  line: string
  loopSummary: string
  councilBrief: string
  reasoningSteps: StoredReasoningStep[]
  /** Si el loop pide otra confirmación, acciones para refrescar la tarjeta. */
  nextPending: DawAction[]
}

export async function runApplyPendingFlow(opts: {
  tienda: TiendaDAW
  conversationId: string
  messageId: string
  agentMode: string
  actions: DawAction[]
  indices: number[]
  chat: (body: string) => Promise<string>
  userTextHint?: string
  /** Chat multi-turno para el diálogo del consejo post-Aplicar. */
  councilChat?: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  onCouncilStep?: (steps: StoredReasoningStep[]) => void
  onCouncilPhase?: (label: string) => void
  abort?: AbortSignal
  paceBetweenPhasesMs?: number
}): Promise<ApplyPendingFlowResult> {
  const { tienda, conversationId, messageId, agentMode, actions, indices, chat } = opts
  const toIdx = indices
  const agentRun = getActiveAgentRun()
  const userText =
    agentRun?.userText ||
    opts.userTextHint ||
    ''
  const wipeIntent = isProjectWipeIntent(userText)

  let toApply = toIdx.map((i) => actions[i]!).filter(Boolean)
  if (wipeIntent) {
    toApply = ensureWipeProjectAction(toApply, userText, true)
  }

  for (const a of toApply) {
    appendAiDawAudit({
      conversationId,
      messageId,
      agentMode,
      source: 'user_build',
      tool: a.type,
      params: { ...(a.payload ?? {}) },
      status: 'proposed',
    })
  }

  const resumeAgentLoop =
    Boolean(agentRun?.pendingCalls.length) &&
    agentRun?.conversationId === conversationId &&
    agentRun?.messageId === messageId &&
    !wipeIntent

  let ok = false
  let line = ''
  let loopSummary = ''
  let councilBrief = ''
  let reasoningSteps: StoredReasoningStep[] = []
  let nextPending: DawAction[] = []

  const continueBrief = (success: boolean, detail: string, council?: string) =>
    [
      success
        ? 'El usuario pulsó Aplicar y la acción se ejecutó con éxito.'
        : `Aplicar falló: ${detail}`,
      'Analiza el estado REAL del proyecto (track.list) y continúa o pide feedback.',
      wipeIntent
        ? 'Si quedan pistas: daw.wipeProject. Si quedó vacío: complete.'
        : 'Si el trabajo creativo está listo: Kael (QA) pregunta si le gustó (request-user-input / CLARIFY). PROHIBIDO complete silencioso.',
      council?.trim()
        ? `## Acuerdo del consejo (post-Aplicar)\n${council.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

  const runCouncilThenLoop = async (): Promise<void> => {
    if (opts.councilChat) {
      const { runCouncilReviewForTurn } = await import('./agent-reasoning-bridge')
      const review = await runCouncilReviewForTurn({
        tienda,
        state: tienda.obtenerEstado(),
        userText: userText || 'continúa con el trabajo pendiente',
        resolvedMode: ((agentMode as AgentMode) || 'create') as AgentMode,
        applyOutcome: [ok ? 'Aplicar OK' : 'Aplicar con fallos', line].filter(Boolean).join('\n'),
        chatFn: opts.councilChat,
        onStep: opts.onCouncilStep,
        onPhaseLabel: opts.onCouncilPhase,
        abort: opts.abort,
        paceBetweenPhasesMs: opts.paceBetweenPhasesMs,
      })
      reasoningSteps = review.steps
      councilBrief = review.decisionBrief || review.finalUserMessage || ''
      if (review.finalUserMessage?.trim()) {
        loopSummary = [loopSummary, review.finalUserMessage.trim()].filter(Boolean).join('\n')
      }
    }

    const loop = await runCoproducerAgentLoop({
      tienda,
      userText: userText || 'continúa con el trabajo pendiente',
      chat,
      agentMode: (agentMode as AgentMode) || 'create',
      conversationId,
      messageId,
      priorBrief: continueBrief(ok, line, councilBrief),
    })
    loopSummary = [loopSummary, loop.summary].filter(Boolean).join('\n')
    if (loop.status === 'waiting-for-confirmation' && loop.pendingCalls?.length) {
      nextPending = pendingCallsToDawActions(loop)
      if (wipeIntent) nextPending = ensureWipeProjectAction(nextPending, userText, true)
    } else if (loop.status === 'completed' || loop.status === 'failed') {
      clearActiveAgentRun()
    }
  }

  if (wipeIntent && toApply.some((a) => a.type === 'daw.wipeProject')) {
    const results = await executeDawActions(tienda, withAplicarTrue(toApply), {
      agentMode: 'create',
      forceApply: true,
      source: 'user_build',
      conversationId,
      messageId,
      respectModeGate: false,
    })
    ok = results.every((r) => r.success)
    line = formatActionResultsForUser(results)
    invalidateAgentRunForMessage(conversationId, messageId)
    await runCouncilThenLoop()
    return { ok, line, loopSummary, councilBrief, reasoningSteps, nextPending }
  }

  if (resumeAgentLoop) {
    const applied = await applyPendingAgentRun({
      tienda,
      agentMode: (agentMode as AgentMode) || 'create',
      chat,
      abort: opts.abort,
      beforeResume: opts.councilChat
        ? async ({ ok: applyOk, applyResults }) => {
            const applyLine = [
              applyOk ? 'Aplicado (Agent Loop).' : 'Algunas tools fallaron.',
              ...applyResults.map(
                (r) =>
                  `${r.status === 'success' ? '✓' : '✗'} ${r.tool}${r.error?.message ? `: ${r.error.message}` : ''}`,
              ),
            ].join(' ')
            const { runCouncilReviewForTurn } = await import('./agent-reasoning-bridge')
            const review = await runCouncilReviewForTurn({
              tienda,
              state: tienda.obtenerEstado(),
              userText: userText || 'continúa con el trabajo pendiente',
              resolvedMode: ((agentMode as AgentMode) || 'create') as AgentMode,
              applyOutcome: applyLine,
              chatFn: opts.councilChat,
              onStep: opts.onCouncilStep,
              onPhaseLabel: opts.onCouncilPhase,
              abort: opts.abort,
              paceBetweenPhasesMs: opts.paceBetweenPhasesMs,
            })
            reasoningSteps = review.steps
            councilBrief = review.decisionBrief || review.finalUserMessage || ''
            if (review.finalUserMessage?.trim()) {
              loopSummary = review.finalUserMessage.trim()
            }
            return councilBrief
              ? `## Acuerdo del consejo (post-Aplicar)\n${councilBrief}`
              : undefined
          }
        : undefined,
    })
    if (!applied.applyResults.length && !applied.conflict) {
      invalidateAgentRunForMessage(conversationId, messageId)
      const results = await executeDawActions(tienda, withAplicarTrue(toApply), {
        agentMode: 'create',
        forceApply: true,
        source: 'user_build',
        conversationId,
        messageId,
        respectModeGate: false,
      })
      ok = results.every((r) => r.success)
      line = formatActionResultsForUser(results)
    } else if (applied.conflict) {
      return {
        ok: false,
        line: applied.conflict,
        loopSummary: applied.runInvalidated ? 'Propuesta obsoleta — escribe de nuevo.' : '',
        councilBrief: '',
        reasoningSteps: [],
        nextPending: [],
      }
    } else {
      ok =
        applied.applyResults.length > 0 &&
        applied.applyResults.every((r) => r.status === 'success')
      line = [
        ok ? 'Aplicado (Agent Loop).' : 'Algunas tools fallaron.',
        ...applied.applyResults.map(
          (r) =>
            `${r.status === 'success' ? '✓' : '✗'} ${r.tool}${r.error?.message ? `: ${r.error.message}` : ''}`,
        ),
      ].join(' ')
      loopSummary = [loopSummary, applied.loop?.summary || ''].filter(Boolean).join('\n')
      if (
        applied.loop?.status === 'waiting-for-confirmation' &&
        applied.loop.pendingCalls?.length
      ) {
        nextPending = pendingCallsToDawActions(applied.loop)
        if (wipeIntent) nextPending = ensureWipeProjectAction(nextPending, userText, true)
      }
      return { ok, line, loopSummary, councilBrief, reasoningSteps, nextPending }
    }
  } else {
    if (
      agentRun &&
      agentRun.conversationId === conversationId &&
      agentRun.messageId === messageId
    ) {
      invalidateAgentRunForMessage(conversationId, messageId)
    }
    const results = await executeDawActions(tienda, withAplicarTrue(toApply), {
      agentMode: 'create',
      forceApply: true,
      source: 'user_build',
      conversationId,
      messageId,
      respectModeGate: false,
    })
    ok = results.every((r) => r.success)
    line = formatActionResultsForUser(results)
  }

  // Tras aplicar (legacy o wipe parcial): consejo + reanalizar
  await runCouncilThenLoop()

  return { ok, line, loopSummary, councilBrief, reasoningSteps, nextPending }
}

/**
 * Puente Agent Loop (ai-harness) ↔ Tool Runner / Event Bus / AgentRun store.
 */

import { runRegisteredTools } from './agent-tool-runner'

import {
  clearActiveAgentRun,
  saveAgentRunFromResult,
  toResumePayload,
  getActiveAgentRun,
  patchActiveAgentRun,
  type PersistedAgentRun,
} from './agent-run-store'
import { EventosIAExt, KNOWN_AGENT_ACTION_TYPES, PLAN_SLUG, getAgentDoc, getStateRevision, isProjectWipeIntent, observeAgentContext, parsePlan, runAgentLoop, toolCallsToLegacyActions } from '@jaswave/host-sdk'
import type { AgentBudget, AgentBudgetTracker, AgentLoopChatReply, AgentLoopToolCall, AgentMode, AgentRunResult, TiendaDAW } from '@jaswave/host-sdk'

export type CoproducerAgentLoopInput = {
  tienda: TiendaDAW
  userText: string
  /** Texto con marcadores o respuesta nativa ya decidida (A2). */
  chat: (systemAndUser: string) => Promise<string | AgentLoopChatReply>
  abort?: AbortSignal
  agentMode: AgentMode
  conversationId: string
  messageId: string
  /** Continuar un run pausado (tras Aplicar). */
  resumeRun?: PersistedAgentRun
  /** Compromiso del reasoning loop (evita re-ensayar 1/6 sin DECISION). */
  priorBrief?: string
  /** Presupuesto compartido del turno (defaults si se omite). */
  budget?: AgentBudgetTracker | Partial<AgentBudget>
}

/** A5: con plan.md estructurado aprobado no se pausa en la primera escritura. */
function hayPlanAprobado(tienda: TiendaDAW): boolean {
  try {
    const pid = tienda.obtenerEstado().project?.id || 'default'
    const md = getAgentDoc(pid, PLAN_SLUG)?.content
    return parsePlan(md)?.estadoPlan === 'aprobado'
  } catch {
    return false
  }
}

export async function runCoproducerAgentLoop(input: CoproducerAgentLoopInput): Promise<AgentRunResult> {
  const { tienda, userText } = input
  const planAprobado = hayPlanAprobado(tienda)
  const resume = input.resumeRun
    ? {
        ...toResumePayload(input.resumeRun),
        // Tras Aplicar: pending ya se ejecutó; resume sin re-ejecutar
        pendingCalls: [] as AgentLoopToolCall[],
      }
    : undefined

  const executedIds = new Set(
    (resume?.results ?? []).filter((r) => r.status === 'success').map((r) => r.callId),
  )

  const wipe = isProjectWipeIntent(userText)
  const sessionStarted =
    Boolean(input.resumeRun) &&
    (input.resumeRun?.results ?? []).some((r) => r.status === 'success')

  const out = await runAgentLoop({
    userText,
    knownTools: KNOWN_AGENT_ACTION_TYPES,
    abort: input.abort,
    requireConfirmationForWrites: !input.resumeRun && !planAprobado,
    // Tras el 1.er Aplicar: sigue uno a uno sin re-pedir confirm en cada paso
    requireConfirmationForDangerous: !(wipe && sessionStarted),
    priorBrief: input.priorBrief,
    budget: input.budget,
    getState: () => tienda.obtenerEstado(),
    observe: (last) =>
      observeAgentContext({
        state: tienda.obtenerEstado(),
        userText,
        lastResults: last,
      }),
    chat: async (prompt, observation) => {
      const body = [observation.text, '', prompt].join('\n')
      return input.chat(body)
    },
    executeCalls: (calls) =>
      runRegisteredTools(tienda, calls, {
        agentMode: input.agentMode,
        forceApply: true,
        source: 'model_actions',
        conversationId: input.conversationId,
        messageId: input.messageId,
        executedCallIds: executedIds,
        // Wipe tras el 1.er Aplicar: el usuario ya confirmó el borrado completo.
        userConfirmed: wipe && sessionStarted,
      }),
    onEvent: (name, payload) => {
      tienda.busEventos.emit(name, payload)
    },
    resume,
  })

  if (out.status === 'waiting-for-confirmation' || out.pendingCalls?.length) {
    saveAgentRunFromResult(out, {
      userText,
      conversationId: input.conversationId,
      messageId: input.messageId,
      runId: input.resumeRun?.runId,
    })
  } else if (out.status === 'completed' || out.status === 'failed' || out.status === 'cancelled') {
    clearActiveAgentRun()
  } else if (out.status === 'waiting-for-user') {
    saveAgentRunFromResult(out, {
      userText,
      conversationId: input.conversationId,
      messageId: input.messageId,
    })
  }

  return out
}

/**
 * Ejecuta pendingCalls del AgentRun activo (botón Aplicar) y reanuda el loop.
 * Si hay STATE_CONFLICT, invalida el run (no deja zombie) y sugiere regenerar.
 */
export async function applyPendingAgentRun(opts: {
  tienda: TiendaDAW
  /** Texto con marcadores o respuesta nativa ya decidida (A2). */
  chat: (systemAndUser: string) => Promise<string | AgentLoopChatReply>
  abort?: AbortSignal
  agentMode: AgentMode
  /** Presupuesto del turno (defaults si se omite). */
  budget?: AgentBudgetTracker | Partial<AgentBudget>
  /** Tras ejecutar pending y ANTES de reanudar el loop (p. ej. diálogo del consejo). */
  beforeResume?: (info: {
    applyResults: Awaited<ReturnType<typeof runRegisteredTools>>
    ok: boolean
  }) => Promise<string | void>
}): Promise<{
  applyResults: Awaited<ReturnType<typeof runRegisteredTools>>
  loop?: AgentRunResult
  conflict?: string
  /** true si el AgentRun se invalidó por conflicto (hay que regenerar propuesta). */
  runInvalidated?: boolean
}> {
  const run = getActiveAgentRun()
  if (!run?.pendingCalls.length) {
    return { applyResults: [] }
  }

  const currentRevision = getStateRevision(opts.tienda.obtenerEstado())
  if (run.stateRevision && run.stateRevision !== currentRevision) {
    clearActiveAgentRun()
    return {
      applyResults: [],
      conflict: `STATE_CONFLICT: revision ${run.stateRevision} → ${currentRevision}. El proyecto cambió desde la propuesta; regenera.`,
      runInvalidated: true,
    }
  }

  let calls = run.pendingCalls
  // Wipe: no ejecutar clip.delete rotos — un solo daw.wipeProject con IDs reales.
  if (isProjectWipeIntent(run.userText)) {
    const { ensureWipeProjectAction } = await import('@jaswave/host-sdk')
    const asActions = toolCallsToLegacyActions(calls)
    const wiped = ensureWipeProjectAction(asActions, run.userText, true)
    if (wiped[0]?.type === 'daw.wipeProject') {
      calls = [
        {
          id: calls[0]?.id ?? 'wipe1',
          tool: 'daw.wipeProject',
          arguments: { aplicar: true, apply: true },
        },
      ]
    }
  }

  const executedIds = new Set(run.results.filter((r) => r.status === 'success').map((r) => r.callId))
  const applyResults = await runRegisteredTools(opts.tienda, calls, {
    agentMode: opts.agentMode,
    forceApply: true,
    source: 'user_build',
    conversationId: run.conversationId,
    messageId: run.messageId,
    executedCallIds: executedIds,
  })
  const failedApply = applyResults.filter((r) => r.status === 'error' || r.status === 'rejected')
  const ok =
    applyResults.length > 0 && applyResults.every((r) => r.status === 'success')
  const mergedResults = [...run.results, ...applyResults]
  patchActiveAgentRun({
    pendingCalls: [],
    results: mergedResults,
    stateRevision: getStateRevision(opts.tienda.obtenerEstado()),
    iteration: run.iteration + 1,
    status: 'executing',
  })
  const updated = getActiveAgentRun()!
  const st = opts.tienda.obtenerEstado()
  const userTracks = (st.project?.tracks ?? []).filter((t) => t.tipo !== 'master')
  const tracks = userTracks.length
  const wipeDone = isProjectWipeIntent(run.userText) && tracks === 0

  const councilExtra = opts.beforeResume
    ? await opts.beforeResume({ applyResults, ok })
    : undefined

  const failureBrief =
    failedApply.length > 0
      ? [
          'Tras Aplicar hubo fallos — DEBES verificar y corregir antes de complete:',
          ...failedApply.map((f) => `- ${f.tool}: ${f.error?.message ?? f.status}`),
          isProjectWipeIntent(run.userText)
            ? 'Si el wipe falló: emite daw.wipeProject { aplicar:true } (IDs reales). PROHIBIDO clip.delete sin clipId.'
            : 'Analiza el estado REAL (track.list) y reintenta solo lo fallido.',
        ].join('\n')
      : wipeDone
        ? 'Proyecto vacío tras wipe. Emite type complete YA. No borres más.'
        : isProjectWipeIntent(run.userText) && tracks > 0
          ? `Wipe incompleto: quedan ${tracks} pistas. Emite daw.wipeProject { aplicar:true } de inmediato.`
          : [
              'Tras Aplicar con éxito: observa el DAW real (track.list + clips).',
              `Pistas usuario ahora: ${tracks}.`,
              'Si el trabajo creativo quedó bien: resumen breve con evidencia (pistas, clips). NO «¿te gustó?».',
              'Solo si hay huecos vacíos: UN midi.clip.create del primer hueco.',
              'PROHIBIDO otro daw.musicBuild si ya hay pistas.',
            ].join('\n')
  const loop = await runCoproducerAgentLoop({
    tienda: opts.tienda,
    userText: updated.userText,
    chat: opts.chat,
    abort: opts.abort,
    agentMode: opts.agentMode,
    conversationId: updated.conversationId,
    messageId: updated.messageId,
    resumeRun: { ...updated, pendingCalls: [], results: mergedResults },
    priorBrief: [failureBrief, councilExtra?.trim()].filter(Boolean).join('\n\n'),
    budget: opts.budget,
  })
  return { applyResults, loop }
}

/** Invalida el AgentRun activo si pertenece a este mensaje (p. ej. Aplicar parcial legacy). */
export function invalidateAgentRunForMessage(conversationId: string, messageId: string): boolean {
  const run = getActiveAgentRun()
  if (!run) return false
  if (run.conversationId !== conversationId || run.messageId !== messageId) return false
  clearActiveAgentRun()
  return true
}

export function pendingCallsToDawActions(result: AgentRunResult) {
  if (!result.pendingCalls?.length) return []
  return toolCallsToLegacyActions(result.pendingCalls)
}

export { EventosIAExt, getActiveAgentRun, clearActiveAgentRun }

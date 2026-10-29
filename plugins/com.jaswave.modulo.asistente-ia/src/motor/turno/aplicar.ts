/**
 * Tarjeta «Aplicar» del agente: ejecuta exactamente los cambios que el usuario eligió, con deshacer por
 * turno. Sin rondas extra de modelo: si hace falta seguir, el usuario lo pide en el chat y el agente
 * continúa con el proyecto real.
 */
import { executeDawActions, isMutatingAction, withAplicarTrue } from '@jaswave/host-sdk'
import type { DawAction, TiendaDAW, TurnContext, TurnProgramOutcome } from '@jaswave/host-sdk'

import type { ApplyPendingAnswer } from '../agent-engine-host'
import { snapshotUndoDepth } from '../agent-turn-undo'
import { getConversation, patchMessage } from '../ai-chat-store'
import type { ApplyPendingFlowResult } from '../pending-apply-flow'

export async function runAplicarAgente(ctx: TurnContext, tienda: TiendaDAW, a: ApplyPendingAnswer): Promise<TurnProgramOutcome> {
  const elegidas = a.indices.map((i) => a.actions[i]).filter(Boolean) as DawAction[]
  const msg = getConversation(a.conversationId)?.messages.find((m) => m.id === a.messageId)
  const undoInicio = msg?.undoDepthAtStart ?? snapshotUndoDepth(tienda)
  const resultados = elegidas.length
    ? await executeDawActions(tienda, withAplicarTrue(elegidas), {
        agentMode: 'create',
        forceApply: true,
        source: 'user_build',
        conversationId: a.conversationId,
        messageId: a.messageId,
        respectModeGate: false,
      })
    : []
  const bien = resultados.filter((r) => r.success).length
  const mal = resultados.length - bien
  const ok = resultados.length > 0 && mal === 0
  const line = !resultados.length
    ? 'No había cambios seleccionados.'
    : ok
      ? `Listo: apliqué ${bien} cambio${bien === 1 ? '' : 's'}.`
      : `Apliqué ${bien} de ${resultados.length} cambios; ${mal === 1 ? 'uno no se pudo hacer' : `${mal} no se pudieron hacer`}. Pídeme que lo revise si quieres.`
  if (resultados.some((r) => r.success && isMutatingAction({ type: r.type }))) {
    patchMessage(a.conversationId, a.messageId, { undoDepthAtStart: undoInicio })
  }
  const out: ApplyPendingFlowResult = { ok, line, loopSummary: '', councilBrief: '', reasoningSteps: [], nextPending: [] }
  ctx.message(line, { final: true })
  return { status: 'completed', summary: line, data: out }
}

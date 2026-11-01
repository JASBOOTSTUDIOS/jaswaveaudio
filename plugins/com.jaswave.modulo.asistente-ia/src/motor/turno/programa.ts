/**
 * Programa de turno del coproductor: los pedidos normales van al agente (`runTurnoAgente`); los chips
 * de inicio sin modelo y la tarjeta Aplicar siguen usando sus flujos propios.
 */
import type { TiendaDAW, TurnProgram } from '@jaswave/host-sdk'

import { createLegacyTurnProgram, type LegacyTurnContext } from '../agent-legacy-turn'
import { updateMessageContent } from '../ai-chat-store'
import type { ApplyPendingAnswer } from '../agent-engine-host'
import { runAplicarAgente } from './aplicar'
import { AGENTE_PROGRAM_ID, runTurnoAgente } from './turno-agente'
import { KIND_BANDA, runTurnoBanda } from './turno-banda'

export function createAgenteTurnProgram(deps: { tienda: TiendaDAW }): TurnProgram {
  const legacy = createLegacyTurnProgram(deps)
  return {
    id: AGENTE_PROGRAM_ID,
    run(ctx) {
      if (ctx.input.kind === 'quick') return legacy.run(ctx)
      if (ctx.input.kind === 'apply') {
        const a = (ctx.input.context as { apply?: ApplyPendingAnswer } | undefined)?.apply
        if (!a) return Promise.resolve({ status: 'failed', error: 'No hay cambios que aplicar.' })
        return runAplicarAgente(ctx, deps.tienda, a)
      }
      if (ctx.input.kind === KIND_BANDA) return runTurnoBanda(ctx, deps.tienda)
      return runTurnoAgente(ctx, deps.tienda)
    },
    answer(ctx, need, answer) {
      if (need.kind === 'apply' && answer.data) return runAplicarAgente(ctx, deps.tienda, answer.data as ApplyPendingAnswer)
      return legacy.answer!(ctx, need, answer)
    },
    resume(ctx) {
      if (ctx.input.kind === 'apply') return Promise.resolve({ status: 'completed', summary: 'Interrumpido: vuelve a pulsar Aplicar.' })
      if (ctx.input.kind === 'quick') return legacy.resume ? legacy.resume(ctx) : legacy.run(ctx)
      // Recarga a mitad de turno: se repite el turno sobre el mismo mensaje.
      const lc = (ctx.input.context ?? {}) as Partial<LegacyTurnContext>
      if (lc.assistantMsgId) updateMessageContent(ctx.run.conversationId, lc.assistantMsgId, '')
      // Una producción a medias no se repite sola: el usuario decide si la vuelve a lanzar.
      if (ctx.input.kind === KIND_BANDA) return Promise.resolve({ status: 'completed', summary: 'La producción se interrumpió. Lo que ya estaba hecho se conserva: en el panel de la banda verás dónde se quedó y el botón Reanudar.' })
      return runTurnoAgente(ctx, deps.tienda)
    },
  }
}

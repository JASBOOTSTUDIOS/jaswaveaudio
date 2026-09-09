/**
 * Snapshot / revert de un turno del agente vía profundidad de undo.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'

const MAX_REVERT_STEPS = 200

export function snapshotUndoDepth(tienda: TiendaDAW): number {
  return tienda.executor.getUndoDepth()
}

/**
 * Deshace comandos hasta que la pila quede en `targetDepth` (inclusive floor).
 * Devuelve cuántos undos se ejecutaron.
 */
export async function revertUndoToDepth(
  tienda: TiendaDAW,
  targetDepth: number,
): Promise<{ ok: boolean; undone: number; message: string }> {
  const start = tienda.executor.getUndoDepth()
  if (start <= targetDepth) {
    return { ok: true, undone: 0, message: 'Nada que revertir (ya deshecho o sin mutaciones).' }
  }
  let undone = 0
  while (tienda.executor.getUndoDepth() > targetDepth && undone < MAX_REVERT_STEPS) {
    const r = await tienda.executor.undo()
    if (!r.success) {
      return {
        ok: false,
        undone,
        message: r.error?.message ?? 'Error al deshacer',
      }
    }
    undone += 1
  }
  if (tienda.executor.getUndoDepth() > targetDepth) {
    return {
      ok: false,
      undone,
      message: `Tope de seguridad (${MAX_REVERT_STEPS} undos). Quedan pasos por deshacer.`,
    }
  }
  return { ok: true, undone, message: `Revertidos ${undone} comando(s).` }
}

export function canRevertTurn(opts: {
  undoDepthAtStart?: number
  reverted?: boolean
  currentDepth: number
}): boolean {
  if (opts.reverted) return false
  if (opts.undoDepthAtStart == null) return false
  return opts.currentDepth > opts.undoDepthAtStart
}

export function toStoredCertify(result: {
  healthOk: boolean
  shouldRepair: boolean
  issues: string[]
  planEval: { done: number; planned: number } | null
  auditErrors?: number
  sectionGaps?: number
}): {
  healthOk: boolean
  shouldRepair: boolean
  issues: string[]
  planDone?: number
  planPlanned?: number
  auditErrors?: number
  sectionGaps?: number
} {
  return {
    healthOk: result.healthOk,
    shouldRepair: result.shouldRepair,
    issues: result.issues.slice(0, 12),
    planDone: result.planEval?.done,
    planPlanned: result.planEval?.planned,
    auditErrors: result.auditErrors,
    sectionGaps: result.sectionGaps,
  }
}

/**
 * Ejecuta un comando y notifica fallos vía bus (event-toasts / UI).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { CommandResult } from '../../../shared/src/types/command'

export async function executeOrNotify(
  tienda: TiendaDAW,
  type: string,
  payload: unknown = {},
): Promise<CommandResult> {
  try {
    const result = await tienda.executor.execute(type, payload)
    if (!result.success) {
      const msg = result.error?.message ?? `Comando fallido: ${type}`
      tienda.busEventos.emit('comando.fallido', {
        type,
        error: msg,
        code: result.error?.code ?? 'EXECUTE_FAILED',
      })
    }
    return result
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    tienda.busEventos.emit('comando.fallido', { type, error: msg, code: 'EXECUTE_EXCEPTION' })
    return {
      success: false,
      state: tienda.obtenerEstado(),
      events: [],
      error: { code: 'EXECUTE_EXCEPTION', message: msg },
    }
  }
}

export async function undoOrNotify(tienda: TiendaDAW): Promise<CommandResult> {
  const result = await tienda.executor.undo()
  if (!result.success && result.error?.code !== 'NOTHING_TO_UNDO') {
    tienda.busEventos.emit('comando.fallido', {
      type: 'undo',
      error: result.error?.message ?? 'Undo fallido',
      code: result.error?.code,
    })
  }
  return result
}

export async function redoOrNotify(tienda: TiendaDAW): Promise<CommandResult> {
  const result = await tienda.executor.redo()
  if (!result.success && result.error?.code !== 'NOTHING_TO_REDO') {
    tienda.busEventos.emit('comando.fallido', {
      type: 'redo',
      error: result.error?.message ?? 'Redo fallido',
      code: result.error?.code,
    })
  }
  return result
}

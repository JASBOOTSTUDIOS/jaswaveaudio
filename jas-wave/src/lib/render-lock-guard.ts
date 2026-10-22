/**
 * U6: durante un bounce la app queda bloqueada. Además de la UI, se bloquean
 * los comandos que editan la línea de tiempo, el grafo de audio o el
 * transporte (ratón, teclado, menús, IA y scripts). Solo quedan permitidos
 * `render.*`, `analysis.*`, `ui.*`, `selection.*` y `atajos.*`.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { CommandResult } from '../../../shared/src/types/command'
import { comandoBloqueadoDuranteRender, estaRenderLock } from './render-lock'

export const MENSAJE_BLOQUEO_RENDER = 'Hay un bounce en curso: no se puede editar el proyecto.'

/** Instala la guardia en el ejecutor de la tienda (idempotente). */
export function instalarGuardiaRenderLock(tienda: TiendaDAW): void {
  const executor = tienda.executor as unknown as {
    execute: (type: string, payload: unknown, ...rest: unknown[]) => Promise<CommandResult>
    __guardiaRenderLock?: boolean
  }
  if (executor.__guardiaRenderLock) return
  executor.__guardiaRenderLock = true

  const original = executor.execute.bind(executor)

  executor.execute = async (type: string, payload: unknown, ...rest: unknown[]) => {
    if (estaRenderLock() && comandoBloqueadoDuranteRender(type)) {
      return {
        success: false,
        state: tienda.obtenerEstado(),
        events: [],
        error: { code: 'RenderBusy', message: MENSAJE_BLOQUEO_RENDER },
      } satisfies CommandResult
    }
    return original(type, payload, ...rest)
  }
}

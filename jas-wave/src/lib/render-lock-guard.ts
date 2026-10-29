/**
 * U6: durante un bounce la app queda bloqueada. Además de la UI, se bloquean
 * los comandos que editan la línea de tiempo, el grafo de audio o el
 * transporte (ratón, teclado, menús, IA y scripts). Solo quedan permitidos
 * `render.*`, `analysis.*`, `ui.*`, `selection.*` y `atajos.*`.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { CommandResult } from '../../../shared/src/types/command'
import { comandoBloqueadoDuranteRender, esperarFinDeRender, estaRenderLock } from './render-lock'

export const MENSAJE_BLOQUEO_RENDER = 'Hay un bounce en curso: no se puede editar el proyecto.'
/** Cuánto espera una escritura de la IA a que termine un render antes de rendirse (un render colgado no la bloquea para siempre). */
export const ESPERA_IA_MS = 150_000

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
      // La IA (y los scripts) no pueden «reintentar al ver el botón habilitado» como una persona: sus escrituras esperan
      // a que termine la medición en curso en vez de fallar y obligar al modelo a repetir la llamada.
      if (rest[0] === 'ai' && (await esperarFinDeRender(ESPERA_IA_MS))) return original(type, payload, ...rest)
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

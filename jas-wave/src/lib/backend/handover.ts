/**
 * Handover web → escritorio (H1, V5 §4).
 *
 * Web: guarda proyecto, cursor, selección y reproducción + la sesión en un token de un solo uso y
 * abre `jaswave://abrir?token=…`. Escritorio: canjea el token, adopta la sesión (sin pedir login),
 * valida el proyecto con el esquema y restaura todo. Objetivo V5: menos de 3 s tras recibir el enlace.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import type { DAWState } from '../../../../shared/src/types/state'
import { validarProyecto } from '../../../../shared/src/schemas/proyecto'
import { withUpdatedStateRevision } from '../../../../shared/src/state/state-revision'
import type { ClienteApi } from './api'

export type DatosHandover = {
  proyecto: unknown
  transporte: { segundos: number; reproduciendo: boolean }
  seleccion: unknown
  salaId?: string
}

/** Extrae lo que se lleva al escritorio (sin estado efímero de UI ni cachés). */
export function datosParaHandover(estado: DAWState, salaId?: string): DatosHandover {
  return {
    proyecto: estado.project,
    transporte: { segundos: estado.transport.posicion?.segundos ?? 0, reproduciendo: !!estado.transport.reproduciendo },
    seleccion: estado.selection,
    ...(salaId ? { salaId } : {}),
  }
}

export async function crearEnlaceHandover(
  api: ClienteApi,
  estado: DAWState,
  sesion: { access_token: string; refresh_token: string } | null,
  salaId?: string,
): Promise<string> {
  const r = await api.handover.crear(datosParaHandover(estado, salaId) as unknown as Record<string, unknown>, sesion ?? undefined)
  return r.url
}

export type ResultadoHandover = { ms: number; reproduciendo: boolean; salaId?: string }

/**
 * Restaura en el escritorio lo recibido de la web. `adoptarSesion` instala la sesión de Supabase.
 * El proyecto se valida antes de reemplazar el estado; si no es válido no se toca nada.
 */
export async function aplicarHandover(
  token: string,
  deps: {
    api: ClienteApi
    tienda: TiendaDAW
    adoptarSesion: (s: { access_token: string; refresh_token: string }) => Promise<void>
    ahora?: () => number
  },
): Promise<ResultadoHandover> {
  const ahora = deps.ahora ?? (() => performance.now())
  const t0 = ahora()
  const { datos, sesion } = await deps.api.handover.canjear(token)
  const d = datos as Partial<DatosHandover>
  const validado = validarProyecto(d.proyecto)
  if (!validado.ok) throw new Error(`El proyecto recibido no es válido: ${validado.error}`)
  if (sesion) await deps.adoptarSesion(sesion)

  const actual = deps.tienda.obtenerEstado()
  const nuevo = withUpdatedStateRevision({
    ...actual,
    project: d.proyecto as DAWState['project'],
    selection: (d.seleccion as DAWState['selection']) ?? actual.selection,
    transport: { ...actual.transport, reproduciendo: false },
  })
  // Proyecto distinto: el historial de deshacer anterior no aplica.
  deps.tienda.executor.reemplazarEstado(nuevo, { limpiarPila: true })
  const segundos = Math.max(0, Number(d.transporte?.segundos) || 0)
  await deps.tienda.executor.execute('transport.seek', { segundos })
  const reproduciendo = !!d.transporte?.reproduciendo
  if (reproduciendo) await deps.tienda.executor.execute('transport.toggle', {})
  return { ms: ahora() - t0, reproduciendo, ...(d.salaId ? { salaId: d.salaId } : {}) }
}

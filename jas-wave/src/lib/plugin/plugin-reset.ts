/**
 * Restablecer un plugin a sus valores por defecto (G4).
 *
 * Los valores por defecto son los que reporta el propio VST (`defaultNormalizedValue` de listParameters),
 * no un 0 o un punto medio inventado. Todo pasa por `plugin.setParameter` en un único batch: un solo paso
 * de deshacer, auditado, y el host se sincroniza por el evento `plugin.parametro.cambiado`
 * (ver `sincronizarParametrosConHost`), también al deshacer y rehacer.
 */

import type { CommandPayload } from '../../../../shared/src/types/command'
import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import { EventosPlugin } from '../../../../shared/src/constants/nombres-eventos'
import type { HostParameterRaw } from './plugin-parameter-intel'
import { extractHostPluginPath } from './plugin-info-adapter'
import { ensureTrackVstPlugin, listSlotParameters, setSlotParameter, slotIdForTrackPlugin } from './track-vst-runtime'

/** Diferencia mínima para considerar que un parámetro se ha movido de su valor por defecto. */
const EPS = 1e-6

export function idHostDePista(trackId: string): string {
  return trackId === 'master' || trackId === '__master__' ? 'master' : trackId
}

/**
 * Comandos `plugin.setParameter` que devuelven a su valor por defecto los parámetros movidos.
 * Se saltan los de solo lectura, los de cambio de programa (cargarían otro preset) y los que no
 * reportan valor por defecto. `soloIds` limita a esos parámetros (reset de uno solo).
 */
export function comandosRestablecer(
  trackId: string,
  pluginInstanceId: string,
  params: HostParameterRaw[],
  soloIds?: ReadonlyArray<string>,
): CommandPayload[] {
  const filtro = soloIds?.length ? new Set(soloIds.map(String)) : null
  const out: CommandPayload[] = []
  for (const p of params) {
    const id = String(p.parameterId ?? p.id ?? '')
    if (!id || p.readOnly || p.programChange) continue
    if (filtro && !filtro.has(id)) continue
    const def = Number(p.defaultNormalizedValue)
    if (!Number.isFinite(def)) continue
    const valor = Math.min(1, Math.max(0, def))
    if (Math.abs((Number(p.normalizedValue) || 0) - valor) < EPS) continue
    out.push({
      type: 'plugin.setParameter',
      payload: {
        trackId,
        pluginInstanceId,
        parameterId: id,
        normalizedValue: valor,
        ...(p.name ? { name: p.name } : {}),
      },
    })
  }
  return out
}

export type ResultadoRestablecer = { ok: boolean; mensaje: string; cambiados: number }

/** Lee los parámetros en vivo del VST y los restablece (todos o `soloIds`) en un paso de deshacer. */
export async function restablecerPlugin(
  tienda: TiendaDAW,
  opts: { trackId: string; pluginInstanceId: string; soloIds?: string[]; source?: 'user' | 'ai' | 'script' },
): Promise<ResultadoRestablecer> {
  const st = tienda.obtenerEstado()
  const hostId = idHostDePista(opts.trackId)
  const cadena =
    hostId === 'master'
      ? st.project.master?.plugins ?? []
      : st.project.tracks.find((t) => t.id === opts.trackId)?.plugins ?? []
  const plugin = cadena.find((p) => p.id === opts.pluginInstanceId)
  if (!plugin) return { ok: false, mensaje: 'El plugin ya no está en la cadena', cambiados: 0 }
  if (!extractHostPluginPath(plugin.descripcion ?? '', plugin.id)) {
    return { ok: false, mensaje: `«${plugin.nombre}» no es un VST cargado en el motor: no expone valores por defecto`, cambiados: 0 }
  }
  await ensureTrackVstPlugin(hostId, plugin)
  const params = await listSlotParameters(slotIdForTrackPlugin(hostId, plugin.id))
  if (!params.length) {
    return { ok: false, mensaje: `«${plugin.nombre}» no respondió con su lista de parámetros (¿motor detenido?)`, cambiados: 0 }
  }
  const comandos = comandosRestablecer(hostId, plugin.id, params, opts.soloIds)
  if (!comandos.length) return { ok: true, mensaje: `«${plugin.nombre}» ya está en sus valores por defecto`, cambiados: 0 }
  const r = await tienda.executor.batch(comandos, opts.source ?? 'user')
  if (!r.success) return { ok: false, mensaje: 'No se pudo restablecer (se deshizo el cambio)', cambiados: 0 }
  return {
    ok: true,
    mensaje:
      comandos.length === 1
        ? `«${plugin.nombre}»: parámetro restablecido`
        : `«${plugin.nombre}»: ${comandos.length} parámetros restablecidos`,
    cambiados: comandos.length,
  }
}

type PayloadParametro = { trackId?: string; pluginInstanceId?: string; parameterId?: string; normalizedValue?: number }

/**
 * Lleva al VST cada `plugin.setParameter` del dominio (UI, IA, editor web, deshacer y rehacer).
 * Solo ids numéricos (los de VST3); los parámetros lógicos por nombre no tienen slot. Devuelve el desuscriptor.
 */
export function sincronizarParametrosConHost(tienda: TiendaDAW): () => void {
  const manejador = (raw: unknown) => {
    const p = (raw ?? {}) as PayloadParametro
    const id = String(p.parameterId ?? '')
    if (!p.trackId || !p.pluginInstanceId || !/^\d+$/.test(id)) return
    const v = Number(p.normalizedValue)
    if (!Number.isFinite(v)) return
    void setSlotParameter(slotIdForTrackPlugin(idHostDePista(p.trackId), p.pluginInstanceId), id, v)
  }
  tienda.busEventos.on(EventosPlugin.parametroCambiado, manejador)
  return () => tienda.busEventos.off(EventosPlugin.parametroCambiado, manejador)
}

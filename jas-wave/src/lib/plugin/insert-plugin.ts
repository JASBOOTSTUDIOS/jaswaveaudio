/**
 * Único camino de inserción de un plugin del catálogo en una pista (o el Master).
 * Lo usan Instrumentos, FX Chain y el inspector de pista; así todos validan, insertan, cargan en el
 * host y (solo si se pide) abren el editor de la misma manera.
 */

import type { TiendaDAW } from '../../../../shared/src/state/tienda'
import type { PluginInfo } from '../../../../shared/src/types/entidades'
import { catalogPluginInsertable } from '../plugin-host'
import { isJasWaveRolesDescriptor, jasWaveRolesPluginInfo } from './jaswave-roles'
import { descriptorToPluginInfo, VST2_NOT_HOSTED_MSG } from './plugin-info-adapter'
import { openPluginEditor } from './plugin-editor-store'
import type { PluginDescriptor } from './types'

export type InsertPluginResult =
  | { ok: true; info: PluginInfo }
  | { ok: false; message: string }

export type InsertPluginOptions = {
  /** Abrir el editor nativo tras insertar. Por defecto NO: el usuario lo abre con un clic en el slot. */
  openEditor?: boolean
}

/** Mensaje de por qué un descriptor no se puede insertar, o null si sí se puede. */
export function motivoNoInsertable(d: PluginDescriptor): string | null {
  if (catalogPluginInsertable(d)) return null
  return d.format === 'vst2' && !d.hostReady
    ? VST2_NOT_HOSTED_MSG
    : `«${d.name}» aún no está listo para el audio. Escanea de nuevo con el motor en marcha.`
}

export function infoParaDescriptor(d: PluginDescriptor): PluginInfo | null {
  return isJasWaveRolesDescriptor(d) ? jasWaveRolesPluginInfo() ?? descriptorToPluginInfo(d) : descriptorToPluginInfo(d)
}

/** Pista de destino: la indicada o, si no hay ninguna, una pista nueva del tipo adecuado. */
export async function resolverPistaDestino(
  tienda: TiendaDAW,
  trackId: string | null | undefined,
  descriptor: PluginDescriptor,
): Promise<string | null> {
  if (trackId && tienda.obtenerEstado().project.tracks.some((t) => t.id === trackId)) return trackId
  const esInstrumento = /instrument|synth|piano|sampler|kontakt|roles/i.test(`${descriptor.category ?? ''} ${descriptor.name}`)
  const r = await tienda.executor.execute('track.create', {
    nombre: descriptor.name,
    tipo: esInstrumento ? 'midi' : 'audio',
  })
  if (!r.success) return null
  return (r.result as { trackId?: string } | undefined)?.trackId ?? tienda.obtenerEstado().project.tracks.at(-1)?.id ?? null
}

export async function insertPluginOnTrack(
  tienda: TiendaDAW,
  trackId: string,
  descriptor: PluginDescriptor,
  opts: InsertPluginOptions = {},
): Promise<InsertPluginResult> {
  const motivo = motivoNoInsertable(descriptor)
  if (motivo) return { ok: false, message: motivo }
  const info = infoParaDescriptor(descriptor)
  if (!info) return { ok: false, message: `«${descriptor.name}» no está disponible en el catálogo.` }
  const r = await tienda.executor.execute('plugin.insert', { trackId, plugin: info })
  if (!r.success) return { ok: false, message: r.error?.message || `No se pudo añadir «${info.nombre}».` }
  // Carga en el host en segundo plano: la UI no espera ni se bloquea.
  void import('./track-vst-runtime').then((m) => m.ensureTrackVstInstrument(trackId, info)).catch(() => undefined)
  if (opts.openEditor) {
    openPluginEditor({ trackId, pluginId: info.id, pluginName: info.nombre, zone: 'right' })
  }
  return { ok: true, info }
}

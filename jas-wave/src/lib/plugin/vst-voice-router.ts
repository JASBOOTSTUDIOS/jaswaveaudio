/**
 * Preview MIDI: VST de la pista seleccionada si el host lo confirmó.
 */

import {
  ensureHostMidiAudible,
  findTrackPlaybackInstrument,
  getLoadedInstrumentForTrack,
  getLoadedInstrumentsForTrack,
  rememberLoadedInstrument,
  slotIdForTrackPlugin,
} from './track-vst-runtime'
import type { PluginInfo } from '../../../../shared/src/types/entidades'
import type { ZonaMidi } from '../../../../shared/src/types/directo'
import { SeguimientoNotasZona, notasDeSalidaParaPista, zonasDePista } from '../midi-zones'

export type ActiveVstVoiceTarget = {
  slotId: string
  path: string
  trackId: string
  pluginId: string
}

let active: ActiveVstVoiceTarget | null = null
let preferredTrackId: string | null = null
let preferredPlugins: PluginInfo[] | undefined
let forceBuiltin = false
const channelAudible = new Map<string, boolean>()

export function setTrackChannelAudible(trackId: string, audible: boolean): void {
  channelAudible.set(trackId, audible)
}

export function trackChannelIsAudible(trackId: string): boolean {
  return channelAudible.get(trackId) !== false
}

export function getPreferredPreviewTrackId(): string | null {
  return preferredTrackId
}

export function setActiveVstVoiceTarget(target: ActiveVstVoiceTarget | null): void {
  active = target
}

export function getActiveVstVoiceTarget(): ActiveVstVoiceTarget | null {
  return active
}

export function setPreferredVstPreviewTrack(
  trackId: string | null,
  plugins?: PluginInfo[],
): void {
  preferredTrackId = trackId
  preferredPlugins = plugins
}

export function setForceBuiltinPreview(on: boolean): void {
  forceBuiltin = on
  if (on) active = null
}

export function getPreferredLoadedSlotId(): string | null {
  if (!preferredTrackId) return null
  const hit = findTrackPlaybackInstrument(preferredPlugins)
  if (hit && hit.kind !== 'vst') return null
  return getLoadedInstrumentForTrack(preferredTrackId)?.slotId ?? null
}

/** Soft Pad Web Audio eliminado — siempre false (JasWave Roles VST). */
export function preferredTrackPlaysSoftPad(): boolean {
  return false
}

function sendMidi(slotId: string, on: boolean, pitch: number, velocity: number): void {
  try {
    const api = window.electron
    if (!api) return
    const cmd = on
      ? { type: 'noteOn' as const, slotId, pitch, velocity }
      : { type: 'noteOff' as const, slotId, pitch }
    if (typeof api.pluginHostMidi === 'function') {
      void api.pluginHostMidi(cmd)
    } else {
      void api.pluginHostSend?.(cmd)
    }
  } catch {
    /* ignore */
  }
  // Audio en paralelo (no retrasar el primer noteOn).
  if (on) void ensureHostMidiAudible()
}

/**
 * Slot del host: mapa local, o id determinista (ventana undock sin lifecycle).
 */
function resolveTrackSlotId(trackId: string, plugins?: PluginInfo[]): string | null {
  const loaded = getLoadedInstrumentForTrack(trackId)
  if (loaded?.slotId) return loaded.slotId
  const list = plugins ?? preferredPlugins
  const hit = findTrackPlaybackInstrument(list)
  const plugin = hit?.plugin ?? list?.find((p) => !p.bypass)
  if (!plugin) return null
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  const path =
    (typeof plugin.descripcion === 'string' && /\.vst3?/i.test(plugin.descripcion)
      ? plugin.descripcion
      : '') || plugin.id
  rememberLoadedInstrument({
    trackId,
    pluginId: plugin.id,
    path,
    slotId,
    instrument: true,
  })
  setActiveVstVoiceTarget({
    slotId,
    path,
    trackId,
    pluginId: plugin.id,
  })
  return slotId
}

/** Slot principal y capas (otros instrumentos cargados) de la pista, sin repetir. */
export function resolveAllTrackSlotIds(trackId: string, plugins?: PluginInfo[]): string[] {
  const principal = resolveTrackSlotId(trackId, plugins)
  if (!principal) return []
  const out = [principal]
  for (const p of getLoadedInstrumentsForTrack(trackId)) {
    if (!out.includes(p.slotId)) out.push(p.slotId)
  }
  return out
}

export function routeMidiToActiveVst(
  on: boolean,
  pitch: number,
  velocity = 90,
  opts?: { ignoreMute?: boolean },
): boolean {
  if (forceBuiltin) return false
  const slotId =
    active?.slotId ??
    getPreferredLoadedSlotId() ??
    (preferredTrackId ? resolveTrackSlotId(preferredTrackId, preferredPlugins) : null)
  if (!slotId) return false
  const trackId = active?.trackId ?? preferredTrackId
  if (on && trackId && !opts?.ignoreMute && !trackChannelIsAudible(trackId)) return false
  sendMidi(slotId, on, pitch, velocity)
  // Capas: el resto de instrumentos de la misma pista tocan la misma nota.
  if (trackId) {
    for (const p of getLoadedInstrumentsForTrack(trackId)) {
      if (p.slotId !== slotId) sendMidi(p.slotId, on, pitch, velocity)
    }
  }
  return true
}

/** Zonas MIDI del proyecto (K3) para el thru web; las publica midi-controller-host al cambiar el proyecto. */
let zonasLive: readonly ZonaMidi[] = []
const seguimientoZonas = new SeguimientoNotasZona()

export function setLiveMidiZones(zonas: readonly ZonaMidi[] | undefined): void {
  zonasLive = zonas ?? []
}

/** Solo tests. */
export function _reiniciarZonasLive(): void {
  zonasLive = []
  seguimientoZonas.reiniciar()
}

/**
 * MIDI en vivo hacia el VST de una pista concreta (controlador / armado / piano roll). Si la pista tiene
 * zonas activas, la nota pasa por ellas (rango, transposición, curva de velocidad); el note-off se envía al
 * tono que sonó aunque la zona haya cambiado mientras la tecla seguía pisada. `ignorarZonas`: piano roll y
 * previsualizaciones, que ya mandan el tono final.
 */
export function routeMidiToTrack(
  trackId: string,
  on: boolean,
  pitch: number,
  velocity = 90,
  opts?: { ignoreMute?: boolean; plugins?: PluginInfo[]; ignorarZonas?: boolean; canal?: number },
): boolean {
  if (forceBuiltin) return false
  const slots = resolveAllTrackSlotIds(trackId, opts?.plugins)
  if (slots.length === 0) return false
  if (on && !opts?.ignoreMute && !trackChannelIsAudible(trackId)) return false
  const conZonas = !opts?.ignorarZonas && zonasDePista(zonasLive, trackId).length > 0
  if (!conZonas) {
    for (const slotId of slots) sendMidi(slotId, on, pitch, velocity)
    return true
  }
  if (on) {
    const salidas = notasDeSalidaParaPista(zonasLive, trackId, pitch, velocity, opts?.canal ?? 1)
    const previas = seguimientoZonas.noteOn(trackId, pitch, salidas.map((n) => n.pitch))
    for (const slotId of slots) {
      for (const p of previas) sendMidi(slotId, false, p, 0)
      for (const n of salidas) sendMidi(slotId, true, n.pitch, n.velocidad)
    }
    return salidas.length > 0
  }
  const previas = seguimientoZonas.noteOff(trackId, pitch)
  const tonos = previas ?? notasDeSalidaParaPista(zonasLive, trackId, pitch, 0, opts?.canal ?? 1).map((n) => n.pitch)
  for (const slotId of slots) for (const p of tonos) sendMidi(slotId, false, p, 0)
  return true
}

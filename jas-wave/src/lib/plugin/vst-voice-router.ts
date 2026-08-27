/**
 * Preview MIDI: VST de la pista seleccionada si el host lo confirmó.
 */

import {
  ensureHostMidiAudible,
  findTrackPlaybackInstrument,
  getLoadedInstrumentForTrack,
  rememberLoadedInstrument,
  slotIdForTrackPlugin,
} from './track-vst-runtime'
import type { PluginInfo } from '../../../../shared/src/types/entidades'

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
  const fire = () => {
    try {
      const api = window.electron
      if (!api) return
      const cmd = on
        ? { type: 'noteOn' as const, slotId, pitch, velocity }
        : { type: 'noteOff' as const, slotId, pitch }
      if (typeof api.pluginHostMidi === 'function') {
        void api.pluginHostMidi(cmd)
        return
      }
      void api.pluginHostSend?.(cmd)
    } catch {
      /* ignore */
    }
  }
  if (on) {
    void ensureHostMidiAudible().then(fire)
    return
  }
  fire()
}

/**
 * Slot del host: mapa local, o id determinista (ventana undock sin lifecycle).
 */
function resolveTrackSlotId(trackId: string, plugins?: PluginInfo[]): string | null {
  const loaded = getLoadedInstrumentForTrack(trackId)
  if (loaded?.slotId) return loaded.slotId
  const list = plugins ?? preferredPlugins
  const hit = findTrackPlaybackInstrument(list)
  if (!hit?.plugin) return null
  const slotId = slotIdForTrackPlugin(trackId, hit.plugin.id)
  const path =
    (typeof hit.plugin.descripcion === 'string' && /\.vst3?/i.test(hit.plugin.descripcion)
      ? hit.plugin.descripcion
      : '') || hit.plugin.id
  rememberLoadedInstrument({
    trackId,
    pluginId: hit.plugin.id,
    path,
    slotId,
    instrument: true,
  })
  setActiveVstVoiceTarget({
    slotId,
    path,
    trackId,
    pluginId: hit.plugin.id,
  })
  return slotId
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
  return true
}

/** MIDI en vivo hacia el VST de una pista concreta (controlador / armado / piano roll). */
export function routeMidiToTrack(
  trackId: string,
  on: boolean,
  pitch: number,
  velocity = 90,
  opts?: { ignoreMute?: boolean; plugins?: PluginInfo[] },
): boolean {
  if (forceBuiltin) return false
  const slotId = resolveTrackSlotId(trackId, opts?.plugins)
  if (!slotId) return false
  if (on && !opts?.ignoreMute && !trackChannelIsAudible(trackId)) return false
  sendMidi(slotId, on, pitch, velocity)
  return true
}

/**
 * Preview MIDI: VST de la pista seleccionada si el host lo confirmó.
 */

import {
  findTrackPlaybackInstrument,
  getLoadedInstrumentForTrack,
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

export function routeMidiToActiveVst(on: boolean, pitch: number, velocity = 90): boolean {
  if (forceBuiltin) return false
  const slotId = active?.slotId ?? getPreferredLoadedSlotId()
  if (!slotId) return false
  const trackId = active?.trackId ?? preferredTrackId
  if (on && trackId && !trackChannelIsAudible(trackId)) return false
  sendMidi(slotId, on, pitch, velocity)
  return true
}

/** MIDI en vivo hacia el VST de una pista concreta (controlador / armado). */
export function routeMidiToTrack(
  trackId: string,
  on: boolean,
  pitch: number,
  velocity = 90,
): boolean {
  if (forceBuiltin) return false
  const slotId = getLoadedInstrumentForTrack(trackId)?.slotId
  if (!slotId) return false
  if (on && !trackChannelIsAudible(trackId)) return false
  sendMidi(slotId, on, pitch, velocity)
  return true
}

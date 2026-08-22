/**
 * Preview MIDI del DAW usa Web Audio (Soft Pad).
 * El editor VST envía noteOn directo al host — no secuestra el teclado global.
 */

import { getLoadedInstrumentForTrack } from './track-vst-runtime'

export type ActiveVstVoiceTarget = {
  slotId: string
  path: string
  trackId: string
  pluginId: string
}

let active: ActiveVstVoiceTarget | null = null
let preferredTrackId: string | null = null

export function setActiveVstVoiceTarget(target: ActiveVstVoiceTarget | null): void {
  active = target
}

export function getActiveVstVoiceTarget(): ActiveVstVoiceTarget | null {
  return active
}

export function setPreferredVstPreviewTrack(trackId: string | null): void {
  preferredTrackId = trackId
}

export function setForceBuiltinPreview(on: boolean): void {
  if (on) active = null
}

export function getPreferredLoadedSlotId(): string | null {
  if (!preferredTrackId) return null
  return getLoadedInstrumentForTrack(preferredTrackId)?.slotId ?? null
}

/** Siempre false: Soft Pad / piano-roll no deben ir a VST mudos. */
export function routeMidiToActiveVst(_on: boolean, _pitch: number, _velocity = 90): boolean {
  return false
}

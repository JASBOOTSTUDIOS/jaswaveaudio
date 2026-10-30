/**
 * Canal de pista → mix nativo (cadena Reaper) + Web Audio stems.
 */

import {
  allNotesOffSlot,
  getLoadedInstrumentForTrack,
  syncReaperTrackGraph,
} from './track-vst-runtime'
import { setTrackChannelAudible, trackChannelIsAudible } from './vst-voice-router'
import { getEditorPreviewTrackId } from './editor-preview-focus'
import { pistasAudibles } from './track-hierarchy'
import type { PluginInfo } from '../../../../shared/src/types/entidades'

function fireForget(cmd: Record<string, unknown>): void {
  try {
    const api = window.electron
    if (!api) return
    if (typeof api.pluginHostMidi === 'function' && cmd.type === 'allNotesOff') {
      void api.pluginHostMidi(cmd)
      return
    }
    void api.pluginHostSend?.(cmd)
  } catch {
    /* ignore */
  }
}

export type MixRouting = {
  sends?: Array<{
    activo?: boolean
    origenTrackId: string
    destinoBusId: string
    cantidad?: number
  }>
  buses?: Array<{ id: string }>
} | null

export function syncNativeChannelMix(
  tracks: Array<{
    id: string
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
    tipo?: string
    padreId?: string
    plugins?: PluginInfo[]
  }>,
  master?: { volumen?: number; paneo?: number; muted?: boolean; plugins?: PluginInfo[] },
  routing?: MixRouting,
): void {
  const previewId = getEditorPreviewTrackId()
  const audibles = pistasAudibles(tracks, new Set((routing?.buses ?? []).map((b) => b.id)))
  for (const t of tracks) {
    const audible = previewId === t.id ? true : audibles.has(t.id)
    const was = trackChannelIsAudible(t.id)
    setTrackChannelAudible(t.id, audible)
    const loaded = getLoadedInstrumentForTrack(t.id)
    if (loaded && was && !audible) allNotesOffSlot(loaded.slotId)
  }

  syncReaperTrackGraph(tracks, master?.plugins, routing)

  if (master) {
    fireForget({
      type: 'setMasterMix',
      gain: typeof master.volumen === 'number' ? master.volumen : 1,
      muted: Boolean(master.muted),
      pan: typeof master.paneo === 'number' ? Math.max(-1, Math.min(1, master.paneo)) : 0,
    })
  }
}

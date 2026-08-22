/**
 * Canal de pista → mix nativo (cadena Reaper) + Web Audio stems.
 */

import {
  allNotesOffSlot,
  getLoadedInstrumentForTrack,
  syncReaperTrackGraph,
} from './track-vst-runtime'
import { setTrackChannelAudible, trackChannelIsAudible } from './vst-voice-router'
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

export function syncNativeChannelMix(
  tracks: Array<{
    id: string
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
    plugins?: PluginInfo[]
  }>,
  master?: { volumen?: number; muted?: boolean; plugins?: PluginInfo[] },
): void {
  const anySolo = tracks.some((t) => t.soloActiva)
  for (const t of tracks) {
    const audible = anySolo ? Boolean(t.soloActiva) : !t.silenciada
    const was = trackChannelIsAudible(t.id)
    setTrackChannelAudible(t.id, audible)
    const loaded = getLoadedInstrumentForTrack(t.id)
    if (loaded && was && !audible) allNotesOffSlot(loaded.slotId)
  }

  syncReaperTrackGraph(tracks, master?.plugins)

  if (master) {
    fireForget({
      type: 'setMasterMix',
      gain: typeof master.volumen === 'number' ? master.volumen : 1,
      muted: Boolean(master.muted),
    })
  }
}

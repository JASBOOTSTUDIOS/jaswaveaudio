/**
 * Playback de comp por regiones en clip_player nativo.
 */

import { beatsASegundos } from '@/lib/audio-conversions'
import {
  hostClipLoadPath,
  hostClipSchedule,
  hostClipStopAll,
} from '@/src/lib/plugin/host-transport'
import type { DAWState } from '../../../shared/src/types/state'

export async function scheduleCompPlayback(
  state: DAWState,
  opts: { startSec: number; sampleRate: number; stemByTrackId: Map<string, number> },
): Promise<void> {
  hostClipStopAll()
  const bpm = state.project.bpm?.valor ?? 120

  for (const folder of state.project.takeFolders ?? []) {
    const stem = opts.stemByTrackId.get(folder.pistaId)
    if (stem == null) continue

    const previewTakeId = folder.takeActivoId
    const segments = previewTakeId
      ? folder.segments.filter((s) => s.takeId === previewTakeId)
      : folder.segments

    if (segments.length === 0 && previewTakeId) {
      const take = folder.takes.find((t) => t.id === previewTakeId)
      if (take?.archivo) {
        const clipId = `comp-${take.id}`
        if (await hostClipLoadPath(clipId, take.archivo)) {
          const durSec = Math.max(0.01, take.finGrabacion - take.inicioGrabacion)
          hostClipSchedule({
            clipId,
            trackIndex: stem,
            startSample: Math.round(take.inicioGrabacion * opts.sampleRate),
            durationSamples: Math.round(durSec * opts.sampleRate),
            sourceOffsetSamples: 0,
            gain: 1,
            pan: 0,
          })
        }
      }
      continue
    }

    for (const seg of segments) {
      const take = folder.takes.find((t) => t.id === seg.takeId)
      if (!take?.archivo) continue
      const clipId = `comp-${seg.id}`
      if (!(await hostClipLoadPath(clipId, take.archivo))) continue

      const tlStartSec = beatsASegundos(seg.timelineInicio, bpm)
      const tlDurSec = beatsASegundos(seg.timelineFin - seg.timelineInicio, bpm)
      if (tlStartSec + tlDurSec <= opts.startSec) continue

      let delaySec = 0
      let consumed = 0
      if (opts.startSec > tlStartSec) {
        consumed = opts.startSec - tlStartSec
      } else {
        delaySec = tlStartSec - opts.startSec
      }
      const remainSec = Math.min(tlDurSec - consumed, seg.origenFin - seg.origenInicio - consumed)
      if (remainSec <= 0.001) continue

      hostClipSchedule({
        clipId,
        trackIndex: stem,
        startSample: Math.round(delaySec * opts.sampleRate),
        durationSamples: Math.round(remainSec * opts.sampleRate),
        sourceOffsetSamples: Math.round((seg.origenInicio + consumed) * opts.sampleRate),
        gain: 1,
        pan: 0,
      })
    }
  }
}

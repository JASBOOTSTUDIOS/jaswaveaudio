/**
 * Mezcla de sends pista→bus sobre stems (bounce / export).
 * Los rings de stem del host no modelan aux; aquí sumamos amount * stem origen en el stem del bus.
 */

import type { DAWState } from '../../../shared/src/types/state'
import type { StemBuffers } from './bounce-offline-audio'

export function applySendsToStemBuffers(
  state: DAWState,
  stems: StemBuffers,
  trackIndexById: Map<string, number>,
  sampleRate: number,
  frames: number,
): StemBuffers {
  const routing = state.project.routing
  if (!routing?.sends?.length) return stems
  const out = new Map(stems)
  for (const send of routing.sends) {
    if (!send.activo) continue
    const srcIdx = trackIndexById.get(send.origenTrackId)
    const busTrackId = send.destinoBusId
    let dstIdx = trackIndexById.get(busTrackId)
    // Bus de routing.id puede coincidir con track id creado junto al bus
    if (dstIdx == null) {
      const bus = routing.buses.find((b) => b.id === send.destinoBusId)
      if (bus) dstIdx = trackIndexById.get(bus.id)
    }
    if (srcIdx == null || dstIdx == null) continue
    const src = out.get(srcIdx) ?? stems.get(srcIdx)
    if (!src) continue
    let dst = out.get(dstIdx)
    if (!dst) {
      dst = new Float32Array(frames * 2)
      out.set(dstIdx, dst)
    }
    const amount = Math.max(0, Math.min(1, send.cantidad))
    const n = Math.min(src.length, dst.length)
    for (let i = 0; i < n; i++) {
      dst[i]! += src[i]! * amount
    }
  }
  void sampleRate
  return out
}

/**
 * Runtime de automatización: muestreo vol/pan (y params) en play/bounce.
 */

import { sampleTrackAutomation } from '../../../shared/src/commands/automation-commands'
import type { AutomatizacionInfo } from '../../../shared/src/types/entidades'
import type { Track } from '../../../shared/src/types/tracks'
import { setSlotParameter, slotIdForTrackPlugin } from './plugin/track-vst-runtime'

export type MixSnapshot = {
  id: string
  volumen: number
  paneo: number
  silenciada?: boolean
  soloActiva?: boolean
  plugins?: Track['plugins']
}

/** Aplica curvas de volumen/paneo al instante `timeSec`. */
export function applyAutomationAtTime(
  tracks: Array<Pick<Track, 'id' | 'volumen' | 'paneo' | 'silenciada' | 'soloActiva' | 'plugins' | 'automatizaciones'>>,
  timeSec: number,
): MixSnapshot[] {
  return tracks.map((t) => {
    const baseVol = typeof t.volumen === 'number' ? t.volumen : 0.8
    const basePan = typeof t.paneo === 'number' ? t.paneo : 0
    const lanes = t.automatizaciones ?? []
    const volLane = lanes.find((a) => a.parametro === 'volumen' || a.parametro === 'volume')
    const panLane = lanes.find((a) => a.parametro === 'paneo' || a.parametro === 'pan')
    const vol = volLane ? sampleTrackAutomation(volLane, timeSec) : null
    const pan = panLane ? sampleTrackAutomation(panLane, timeSec) : null
    return {
      id: t.id,
      volumen: vol != null && Number.isFinite(vol) ? Math.max(0, Math.min(1.5, vol)) : baseVol,
      paneo: pan != null && Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : basePan,
      silenciada: t.silenciada,
      soloActiva: t.soloActiva,
      plugins: t.plugins,
    }
  })
}

/** Multiplica stem interleaved (LRLR…) por curva de volumen relativa al fader base. */
export function bakeVolumeAutomationIntoStem(
  pcm: Float32Array,
  sampleRate: number,
  startSec: number,
  lane: AutomatizacionInfo | undefined,
  baseVol: number,
): Float32Array {
  if (!lane?.habilitada || !lane.puntos.length) return pcm
  const out = new Float32Array(pcm.length)
  const frames = Math.floor(pcm.length / 2)
  const safeBase = Math.max(1e-6, baseVol)
  for (let i = 0; i < frames; i++) {
    const t = startSec + i / sampleRate
    const v = sampleTrackAutomation(lane, t)
    const gain = v != null && Number.isFinite(v) ? Math.max(0, v) / safeBase : 1
    out[i * 2] = pcm[i * 2]! * gain
    out[i * 2 + 1] = pcm[i * 2 + 1]! * gain
  }
  return out
}

/** Empuja parámetros VST automatizados (throttle externo). */
export function applyParamAutomationAtTime(
  tracks: Array<Pick<Track, 'id' | 'plugins' | 'automatizaciones'>>,
  timeSec: number,
): void {
  for (const t of tracks) {
    for (const lane of t.automatizaciones ?? []) {
      if (!lane.habilitada) continue
      const p = lane.parametro
      if (p === 'volumen' || p === 'volume' || p === 'paneo' || p === 'pan') continue
      const v = sampleTrackAutomation(lane, timeSec)
      if (v == null || !Number.isFinite(v)) continue
      // parametro = "pluginId:paramId" o solo paramId en primer plugin FX
      const [pluginId, paramId] = p.includes(':') ? p.split(':', 2) : [undefined, p]
      const plugins = t.plugins ?? []
      const pl = pluginId
        ? plugins.find((x) => x.id === pluginId)
        : plugins.find((x) => !/instrument|synth/i.test(x.tipo ?? ''))
      if (!pl || !paramId) continue
      const slotId = slotIdForTrackPlugin(t.id, pl.id)
      void setSlotParameter(slotId, paramId, Math.max(0, Math.min(1, v)))
    }
  }
}

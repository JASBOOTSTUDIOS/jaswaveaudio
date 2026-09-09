/**
 * Carga y programa clips de audio en el plugin-host para bounce offline nativo.
 * Sustituye prerenderWebStems (OfflineAudioContext → JWST).
 */

import { audioEngine } from '@/lib/audio-engine'
import {
  hostClipLoadPath,
  hostClipLoadPcm,
  hostClipSchedule,
  hostClipStopAll,
} from '@/src/lib/plugin/host-transport'
import { bakeVolumeAutomationIntoStem } from './automation-runtime'
import type { BounceContent, BounceTrack } from './bounce-content'
import type { DAWState } from '../../../shared/src/types/state'
import type { Track } from '../../../shared/src/types/tracks'

function clipIdFor(track: BounceTrack, inicioSec: number, sourceKey: string): string {
  return `bounce-${track.trackId}-${inicioSec.toFixed(4)}-${sourceKey.replace(/[^\w.-]/g, '_')}`
}

async function resolveBuffer(key: string): Promise<AudioBuffer | undefined> {
  const cached = audioEngine.getAudioBuffer(key)
  if (cached) return cached
  try {
    const bin = await window.electron?.fileReadBinary?.(key)
    if (!bin || bin.byteLength === 0) return undefined
    return await audioEngine.decodeArrayBuffer(key, bin.buffer as ArrayBuffer)
  } catch {
    return undefined
  }
}

async function loadClipPcm(
  clipId: string,
  sourceKey: string,
  track: Track | undefined,
  startSec: number,
  sampleRate: number,
): Promise<boolean> {
  const pathLike =
    sourceKey.includes('\\') ||
    sourceKey.includes('/') ||
    /\.(wav|flac|mp3|ogg|aiff?)$/i.test(sourceKey)

  if (pathLike) {
    const ok = await hostClipLoadPath(clipId, sourceKey)
    if (ok) return true
  }

  const buffer = await resolveBuffer(sourceKey)
  if (!buffer) return false

  let interleaved = bufferToInterleaved(buffer)
  const volLane = track?.automatizaciones?.find(
    (a) => a.parametro === 'volumen' || a.parametro === 'volume',
  )
  const baseVol = typeof track?.volumen === 'number' ? track.volumen : 0.8
  if (volLane?.habilitada && volLane.puntos.length) {
    interleaved = bakeVolumeAutomationIntoStem(interleaved, sampleRate, startSec, volLane, baseVol)
  }

  return hostClipLoadPcm(clipId, interleaved, buffer.length, 2, buffer.sampleRate)
}

function bufferToInterleaved(buffer: AudioBuffer): Float32Array {
  const frames = buffer.length
  const interleaved = new Float32Array(frames * 2)
  const L = buffer.getChannelData(0)
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L
  for (let i = 0; i < frames; i++) {
    interleaved[i * 2] = L[i] ?? 0
    interleaved[i * 2 + 1] = R[i] ?? 0
  }
  return interleaved
}

/**
 * Carga PCM en el host y programa voces para la ventana de bounce.
 * El reloj del host debe estar en sample 0 con playing=true durante renderOfflineStep.
 */
export async function prepareNativeClipsForBounce(
  content: BounceContent,
  dawState: DAWState | undefined,
  opts: { startSec: number; durationSec: number; sampleRate: number },
): Promise<number> {
  hostClipStopAll()
  let scheduled = 0

  for (const bt of content.tracks) {
    if (bt.audioClips.length === 0) continue
    const track = dawState?.project?.tracks?.find((t) => t.id === bt.trackId)

    for (const clip of bt.audioClips) {
      const clipEnd = clip.inicioSec + clip.duracionSec
      if (clipEnd <= opts.startSec) continue
      if (clip.inicioSec >= opts.startSec + opts.durationSec) continue

      const id = clipIdFor(bt, clip.inicioSec, clip.sourceKey)
      const loaded = await loadClipPcm(id, clip.sourceKey, track, clip.inicioSec, opts.sampleRate)
      if (!loaded) continue

      let consumed = 0
      let delaySec = 0
      if (opts.startSec > clip.inicioSec) {
        consumed = opts.startSec - clip.inicioSec
      } else {
        delaySec = clip.inicioSec - opts.startSec
      }

      const remainSec = Math.max(0, clip.duracionSec - consumed)
      const windowRemain = opts.durationSec - delaySec
      const durationSec = Math.min(remainSec, windowRemain)
      if (durationSec <= 0.001) continue

      const startSample = Math.round(delaySec * opts.sampleRate)
      const durationSamples = Math.round(durationSec * opts.sampleRate)
      const sourceOffsetSamples = Math.round((clip.clipInicioSec + consumed) * opts.sampleRate)

      hostClipSchedule({
        clipId: id,
        trackIndex: bt.stemIndex,
        startSample,
        durationSamples,
        sourceOffsetSamples,
        gain: 1,
        pan: 0,
      })
      scheduled += 1
    }
  }

  return scheduled
}

/** Limpia voces programadas tras bounce. */
export function teardownNativeClipsAfterBounce(): void {
  hostClipStopAll()
}

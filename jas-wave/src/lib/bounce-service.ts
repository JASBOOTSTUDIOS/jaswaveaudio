/**
 * Bounce WAV vía plugin-host renderOffline* + loudness BS.1770.
 *
 * Contenido real:
 *  - Notas/CCs de clips MIDI → slots VST con delaySamples absolutos
 *    (la cola por-slot del host los dispara sample-accurate).
 *  - Clips de audio / Soft Pad → pre-render OfflineAudioContext por pista,
 *    alimentados como paquetes JWST inline en cada renderOfflineStep.
 */

import {
  measureLoudnessBs1770,
} from '../../../shared/src/audio/loudness-bs1770'
import { renderJobGet, renderJobUpdate } from '../../../shared/src/render/job-store'
import type { RenderJob } from '../../../shared/src/types/render'
import {
  findTrackPlaybackInstrument,
  getLoadedInstrumentForTrack,
  sendVstCc,
  sendVstNote,
} from '@/src/lib/plugin/track-vst-runtime'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import type {
  BounceContent,
  BounceSlotResolution,
} from './bounce-content'
import { buildBounceContent } from './bounce-content'
import { prerenderWebStems } from './bounce-offline-audio'

const BLOCK = 512

async function hostSend(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = window.electron
  if (!api?.pluginHostSend) throw new Error('Plugin host no disponible')
  await api.pluginHostEnsure?.()
  const raw = (await api.pluginHostSend(cmd)) as Record<string, unknown>
  if (raw && raw.ok === false) {
    throw new Error(String(raw.message ?? raw.code ?? 'render host error'))
  }
  return raw ?? {}
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** PCM float interleaved → bytes little-endian f32 (para base64). */
function f32ToBytes(src: Float32Array): Uint8Array {
  const out = new Uint8Array(src.length * 4)
  const view = new DataView(out.buffer)
  for (let i = 0; i < src.length; i++) view.setFloat32(i * 4, src[i]!, true)
  return out
}

function decodeWavPcm16Stereo(bin: Uint8Array): { l: Float32Array; r: Float32Array; sampleRate: number } | null {
  if (bin.byteLength < 44) return null
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  if (view.getUint32(0, false) !== 0x52494646) return null // 'RIFF'
  const sampleRate = view.getUint32(24, true)
  const dataSize = view.getUint32(40, true)
  const numFrames = Math.floor(dataSize / 4)
  const l = new Float32Array(numFrames)
  const r = new Float32Array(numFrames)
  let o = 44
  for (let i = 0; i < numFrames && o + 3 < bin.byteLength; i++) {
    l[i] = view.getInt16(o, true) / 32768
    r[i] = view.getInt16(o + 2, true) / 32768
    o += 4
  }
  return { l, r, sampleRate }
}

/** Resolución runtime de instrumento por pista (VST slot o Soft Pad). */
export function resolveBounceSlots(
  trackId: string,
  plugins: unknown,
): BounceSlotResolution {
  const hit = findTrackPlaybackInstrument(plugins as PluginInfo[] | undefined)
  if (!hit) return { softPad: false }
  if (hit.kind === 'builtin') return { softPad: true }
  return { slotId: getLoadedInstrumentForTrack(trackId)?.slotId, softPad: false }
}

/** Construye el contenido de bounce con resolución runtime de slots. */
export function buildRuntimeBounceContent(
  state: Parameters<typeof buildBounceContent>[0],
  opts?: { startSec?: number; endSec?: number },
) {
  return buildBounceContent(state, opts, resolveBounceSlots)
}

/** Programa notas/CCs VST con delays absolutos desde el inicio del bounce. */
function scheduleVstEvents(content: BounceContent, sampleRate: number, startSec: number): void {
  for (const track of content.tracks) {
    for (const note of track.notes) {
      if (!note.slotId) continue
      const onFrame = Math.max(0, Math.round((note.startSec - startSec) * sampleRate))
      const offFrame =
        onFrame + Math.max(32, Math.round(note.durSec * sampleRate))
      sendVstNote(note.slotId, true, note.pitch, note.velocity, onFrame)
      sendVstNote(note.slotId, false, note.pitch, 0, offFrame)
    }
    for (const ev of track.ccs) {
      if (!ev.slotId) continue
      const frame = Math.max(0, Math.round((ev.timeSec - startSec) * sampleRate))
      sendVstCc(ev.slotId, ev.cc, ev.value, frame)
    }
  }
}

export async function runNativeBounce(
  job: RenderJob,
  content: BounceContent,
  emit?: (nombre: string, payload: Record<string, unknown>) => void,
): Promise<RenderJob> {
  const startSec = job.start.segundos ?? 0
  const endSec = job.end.segundos ?? startSec + 1
  const duration = Math.max(0.1, endSec - startSec)
  const sr = job.sampleRate || 48000
  const totalFrames = Math.ceil(duration * sr)

  let outPath = job.outputPath
  if (!outPath) {
    try {
      const dir = await window.electron?.recordingsDir?.()
      outPath = dir ? `${dir}/bounce-${job.id}.wav` : `bounce-${job.id}.wav`
    } catch {
      outPath = `bounce-${job.id}.wav`
    }
  }

  renderJobUpdate(job.id, { status: 'rendering', progress: 0, outputPath: outPath })
  emit?.('render.progress', { jobId: job.id, progress: 0 })

  // Stems Web Audio (clips de audio + Soft Pad), DRY por stemIndex.
  const webStems = await prerenderWebStems(content, {
    startSec,
    durationSec: duration,
    sampleRate: sr,
  })

  await hostSend({
    type: 'renderOfflineStart',
    outPath,
    totalFrames,
    blockSize: BLOCK,
    sampleRate: sr,
    bitDepth: job.bitDepth ?? 16,
  })

  try {
    // Las colas MIDI por slot drenan solo cuando renderMix procesa bloques:
    // con el renderer offline activo ningún bloque se consume en vivo.
    scheduleVstEvents(content, sr, startSec)

    let done = 0
    while (done < totalFrames) {
      if (renderJobGet(job.id)?.status === 'cancelled') {
        await hostSend({ type: 'renderOfflineCancel' })
        emit?.('render.cancelled', { jobId: job.id })
        return renderJobGet(job.id) ?? { ...job, status: 'cancelled' }
      }
      const frames = Math.min(BLOCK, totalFrames - done)

      // Paquetes JWST inline: sin carrera entre pipe de PCM y el paso.
      const stems: Array<{ trackIndex: number; b64: string }> = []
      for (const [stemIndex, pcm] of webStems) {
        const slice = pcm.subarray(done * 2, (done + frames) * 2)
        stems.push({ trackIndex: stemIndex, b64: bytesToBase64(f32ToBytes(slice)) })
      }
      await hostSend({ type: 'renderOfflineStep', frames, stems })

      done += frames
      const progress = done / totalFrames
      renderJobUpdate(job.id, {
        status: 'rendering',
        progress: Math.min(99, Math.round(progress * 100)),
      })
      emit?.('render.progress', { jobId: job.id, progress })
    }

    const finish = await hostSend({ type: 'renderOfflineFinish' })
    const path = String(finish.path ?? outPath)
    const framesOut = typeof finish.frames === 'number' ? Number(finish.frames) : totalFrames
    const finishSr = typeof finish.sampleRate === 'number' ? Number(finish.sampleRate) : sr

    let loudness = measureLoudnessBs1770(
      [new Float32Array(Math.min(framesOut, 1)), new Float32Array(Math.min(framesOut, 1))],
      finishSr,
    )
    try {
      const bin = (await window.electron?.fileReadBinary?.(path)) as Uint8Array | undefined
      if (bin) {
        const pcm = decodeWavPcm16Stereo(bin)
        if (pcm && pcm.l.length > 1) {
          loudness = measureLoudnessBs1770([pcm.l, pcm.r], pcm.sampleRate || finishSr)
        } else if (bin && job.bitDepth === 24) {
          // WAV 24-bit: decodificar manualmente para loudness
          const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
          const dataSize = view.getUint32(40, true)
          const numFrames = Math.floor(dataSize / 6)
          const l = new Float32Array(numFrames)
          const r = new Float32Array(numFrames)
          let o = 44
          for (let i = 0; i < numFrames && o + 5 < bin.byteLength; i++) {
            const li = bin[o]! | (bin[o + 1]! << 8) | (bin[o + 2]! << 16)
            const ri = bin[o + 3]! | (bin[o + 4]! << 8) | (bin[o + 5]! << 16)
            l[i] = (li << 8) / 2147483648
            r[i] = (ri << 8) / 2147483648
            o += 6
          }
          if (numFrames > 1) {
            loudness = measureLoudnessBs1770([l, r], finishSr)
          }
        }
      }
    } catch {
      /* sin archivo legible */
    }

    const completed = renderJobUpdate(job.id, {
      status: 'completed',
      progress: 100,
      outputPath: path,
      frames: framesOut,
      loudness,
    })!
    emit?.('render.completed', { jobId: job.id, path, loudness })
    return completed
  } catch (e) {
    // Restaurar el device aunque falle el bounce
    try {
      await hostSend({ type: 'renderOfflineCancel' })
    } catch {
      /* ignore */
    }
    throw e
  }
}

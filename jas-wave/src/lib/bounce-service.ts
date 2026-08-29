/**
 * Bounce WAV vía plugin-host renderOffline* + loudness BS.1770.
 *
 * Contenido real:
 *  - Notas/CCs de clips MIDI → slots VST con delaySamples absolutos
 *    (la cola por-slot del host los dispara sample-accurate).
 *  - Clips de audio → pre-render OfflineAudioContext por pista,
 *    alimentados como paquetes JWST inline en cada renderOfflineStep.
 */

import {
  measureLoudnessBs1770,
} from '../../../shared/src/audio/loudness-bs1770'
import {
  applyGainToChannels,
  buildAudioListenReport,
  measureMixAnalysis,
  normalizeGainForTarget,
} from '../../../shared/src/audio/mix-analysis'
import { renderJobGet, renderJobUpdate } from '../../../shared/src/render/job-store'
import type { RenderJob } from '../../../shared/src/types/render'
import { encodeWavPcm16 } from './encode-wav'
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
import { bakeVolumeAutomationIntoStem } from './automation-runtime'
import { applySendsToStemBuffers } from './send-mix'
import type { DAWState } from '../../../shared/src/types/state'

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

/** Resolución runtime de instrumento por pista (solo slot VST host-loaded). */
export function resolveBounceSlots(
  trackId: string,
  plugins: unknown,
): BounceSlotResolution {
  const loaded = getLoadedInstrumentForTrack(trackId)
  if (loaded?.slotId) return { slotId: loaded.slotId }
  const list = (plugins as PluginInfo[] | undefined) ?? []
  const hit = findTrackPlaybackInstrument(list)
  if (!hit || hit.kind !== 'vst') return {}
  // Dominio tiene instrumento pero host no confirmó load → el caller debe ensure o fallar.
  return {}
}

/** Pistas MIDI/instrumento con VST en dominio pero sin slot host confirmado. */
export function listUnresolvedBounceVstTracks(
  state: DAWState,
): Array<{ trackId: string; nombre: string }> {
  const out: Array<{ trackId: string; nombre: string }> = []
  for (const t of state.project?.tracks ?? []) {
    const hit = findTrackPlaybackInstrument(t.plugins ?? [])
    if (!hit || hit.kind !== 'vst') continue
    if (getLoadedInstrumentForTrack(t.id)?.slotId) continue
    out.push({ trackId: t.id, nombre: t.nombre })
  }
  return out
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
  dawState?: DAWState,
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

  // Asegurar host loads y re-resolver slots (el content puede haberse construido antes del load).
  let bounceContent = content
  if (dawState?.project?.tracks?.length) {
    const { ensureProjectVstInstruments } = await import('@/src/lib/plugin/track-vst-runtime')
    await ensureProjectVstInstruments(dawState.project.tracks, dawState.project.master?.plugins)
    const unresolved = listUnresolvedBounceVstTracks(dawState)
    if (unresolved.length) {
      const names = unresolved.map((u) => u.nombre).slice(0, 6).join(', ')
      const msg = `Bounce abortado: VST sin slot host confirmado (${unresolved.length}): ${names}. Nada que renderizar en silencio.`
      renderJobUpdate(job.id, { status: 'failed', progress: 0, error: msg })
      emit?.('render.error', { jobId: job.id, message: msg })
      const cur = renderJobGet(job.id)
      return cur ?? { ...job, status: 'failed' as const, error: msg }
    }
    bounceContent = buildRuntimeBounceContent(dawState, {
      startSec,
      endSec,
    })
  }

  let midiNotes = 0
  let midiWithSlot = 0
  for (const track of bounceContent.tracks) {
    for (const note of track.notes) {
      midiNotes += 1
      if (note.slotId) midiWithSlot += 1
    }
  }
  if (midiNotes > 0 && midiWithSlot === 0) {
    const msg =
      'Bounce: pistas MIDI sin slot VST host-loaded (instrumentos no cargados). Nada que renderizar.'
    renderJobUpdate(job.id, { status: 'failed', progress: 0, error: msg })
    emit?.('render.error', { jobId: job.id, message: msg })
    const cur = renderJobGet(job.id)
    return cur ?? { ...job, status: 'failed' as const, error: msg }
  }

  // Stems Web Audio (clips de audio), DRY por stemIndex.
  let webStems = await prerenderWebStems(bounceContent, {
    startSec,
    durationSec: duration,
    sampleRate: sr,
  })

  // Automatización de volumen → bake en stems (el fader nativo queda en valor base)
  if (dawState) {
    const trackIndexById = new Map<string, number>()
    bounceContent.tracks.forEach((t) => trackIndexById.set(t.trackId, t.stemIndex))
    for (const bt of bounceContent.tracks) {
      const pcm = webStems.get(bt.stemIndex)
      if (!pcm) continue
      const track = dawState.project.tracks.find((t) => t.id === bt.trackId)
      const lane = track?.automatizaciones?.find(
        (a) => a.parametro === 'volumen' || a.parametro === 'volume',
      )
      const baseVol = typeof track?.volumen === 'number' ? track.volumen : 0.8
      if (lane) {
        webStems.set(bt.stemIndex, bakeVolumeAutomationIntoStem(pcm, sr, startSec, lane, baseVol))
      }
    }
    // Sends en el host nativo (stems DRY); evita doble suma TS+host.
    // webStems permanecen dry; renderMix aplica sends live.
  }

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
    scheduleVstEvents(bounceContent, sr, startSec)

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
    let pcmL: Float32Array | null = null
    let pcmR: Float32Array | null = null
    try {
      const bin = (await window.electron?.fileReadBinary?.(path)) as Uint8Array | undefined
      if (bin) {
        const pcm = decodeWavPcm16Stereo(bin)
        if (pcm && pcm.l.length > 1) {
          loudness = measureLoudnessBs1770([pcm.l, pcm.r], pcm.sampleRate || finishSr)
          pcmL = pcm.l
          pcmR = pcm.r
        } else if (bin && job.bitDepth === 24) {
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
            pcmL = l
            pcmR = r
          }
        }
      }
    } catch {
      /* sin archivo legible */
    }

    const channels =
      pcmL && pcmR ? [pcmL, pcmR] : [new Float32Array(1), new Float32Array(1)]
    let analysis = measureMixAnalysis(channels, finishSr)
    let outPathFinal = path
    let normalized = false

    if ((job.normalize === 'peak' || job.normalize === 'lufs') && pcmL && pcmR) {
      const normalizeTarget =
        job.normalizeTargetDb ?? (job.normalize === 'lufs' ? -14 : -1)
      const gain = normalizeGainForTarget(analysis, job.normalize, normalizeTarget)
      const gained = applyGainToChannels([pcmL, pcmR], gain)
      const wav = encodeWavPcm16(gained, finishSr)
      const normPath = path.replace(/\.wav$/i, '.norm.wav')
      await window.electron?.fileSaveBinary?.(normPath, wav)
      outPathFinal = normPath
      analysis = measureMixAnalysis(gained, finishSr)
      loudness = analysis.loudness
      normalized = true
    }

    if (job.format === 'flac' || job.format === 'mp3') {
      const converted = await tryConvertWithFfmpeg(outPathFinal, job.format, job.bitrate)
      if (converted) {
        outPathFinal = converted
      } else {
        throw new Error(
          `ffmpeg no disponible o falló la conversión a ${job.format.toUpperCase()}. ` +
            `Se dejó WAV en ${outPathFinal}. Instala ffmpeg en PATH o exporta WAV.`,
        )
      }
    }

    const listenReport = buildAudioListenReport(analysis, {
      target: job.listenTarget,
      maxTruePeakDb: -1,
    })

    const stemsPaths: string[] = []
    if (job.exportStems && webStems.size) {
      const base = outPathFinal.replace(/\.[^.]+$/, '')
      const stemsDir = `${base}-stems`
      for (const [stemIndex, pcm] of webStems) {
        const framesStem = Math.floor(pcm.length / 2)
        const l = new Float32Array(framesStem)
        const r = new Float32Array(framesStem)
        for (let i = 0; i < framesStem; i++) {
          l[i] = pcm[i * 2]!
          r[i] = pcm[i * 2 + 1]!
        }
        const stemPath = `${stemsDir}/stem${stemIndex}.wav`
        const wav = encodeWavPcm16([l, r], finishSr)
        await window.electron?.fileSaveBinary?.(stemPath, wav)
        stemsPaths.push(stemPath)
      }
    }

    const completed = renderJobUpdate(job.id, {
      status: 'completed',
      progress: 100,
      outputPath: outPathFinal,
      frames: framesOut,
      loudness,
      analysis,
      listenReport,
      stemsPaths: stemsPaths.length ? stemsPaths : undefined,
      normalized,
    })!
    emit?.('render.completed', { jobId: job.id, path: outPathFinal, loudness, listenReport })
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

async function tryConvertWithFfmpeg(
  wavPath: string,
  format: 'flac' | 'mp3',
  bitrate?: number,
): Promise<string | null> {
  try {
    const out = wavPath.replace(/\.wav$/i, `.${format}`)
    const api = window.electron as {
      ffmpegConvert?: (input: string, output: string, args?: string[]) => Promise<{ ok: boolean }>
    }
    if (api.ffmpegConvert) {
      const br = bitrate ? [`-b:a`, `${bitrate}k`] : format === 'mp3' ? ['-b:a', '192k'] : []
      const r = await api.ffmpegConvert(wavPath, out, br)
      if (r?.ok) return out
    }
  } catch {
    /* optional */
  }
  return null
}

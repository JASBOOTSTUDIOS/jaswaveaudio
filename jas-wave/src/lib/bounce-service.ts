/**
 * Bounce vía plugin-host renderOffline* + loudness BS.1770.
 *
 * Contenido real:
 *  - Notas/CCs de clips MIDI → slots VST con delaySamples absolutos
 *  - Clips de audio → clip_player nativo (mismo motor que Play)
 *
 * Salida (G2):
 *  - El motor escribe WAV (16/24 bits o 32 float) y, en la misma pasada, un WAV por pista (stems con
 *    inserts, fader, paneo y envíos recibidos).
 *  - Sin final pedido se renderiza una cola de hasta 10 s tras el último clip y se recorta el silencio.
 *  - Otros formatos (AIFF/FLAC/MP3/OGG/AAC/Opus) se codifican desde ese WAV con ffmpeg.
 */

import { measureLoudnessBs1770 } from '../../../shared/src/audio/loudness-bs1770'
import {
  applyGainToChannels,
  buildAudioListenReport,
  measureMixAnalysis,
  normalizeGainForTarget,
} from '../../../shared/src/audio/mix-analysis'
import { renderJobGet, renderJobUpdate } from '../../../shared/src/render/job-store'
import {
  COLA_MAXIMA_SEGUNDOS,
  detectarFinProyecto,
  framesConCola,
} from '../../../shared/src/render/fin-proyecto'
import type { RenderJob } from '../../../shared/src/types/render'
import { RENDER_EXTENSION } from '../../../shared/src/types/render'
import { activarRenderLock, desactivarRenderLock } from './render-lock'
import { decodeWav, encodeWav, type WavBitDepth } from './encode-wav'
import {
  findTrackPlaybackInstrument,
  getLoadedInstrumentForTrack,
  getLoadedInstrumentsForTrack,
  sendVstCc,
  sendVstNote,
} from '@/src/lib/plugin/track-vst-runtime'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import type {
  BounceContent,
  BounceSlotResolution,
} from './bounce-content'
import { buildBounceContent } from './bounce-content'
import {
  prepareNativeClipsForBounce,
  teardownNativeClipsAfterBounce,
} from './bounce-native-clips'
import {
  hayAutomatizacion,
  publicarAutomatizacionBounce,
  type ContextoAutomatizacionBounce,
} from './automation-runtime'
import { syncReaperTrackGraph } from '@/src/lib/plugin/track-vst-runtime'
import type { DAWState } from '../../../shared/src/types/state'

import { saveBinaryOrThrow } from './electron-fs'

const BLOCK = 512
/** Tope de stems por export: el grafo nativo procesa como mucho 64 pistas. */
const MAX_STEMS = 64

async function hostSend(cmd: Record<string, unknown>): Promise<Record<string, unknown>> {
  const api = window.electron
  if (!api?.pluginHostSend) throw new Error('Plugin host no disponible')
  await api.pluginHostEnsure?.()
  const raw = (await api.pluginHostSend(cmd)) as Record<string, unknown>
  if (raw && raw.ok === false) {
    throw new Error(String(raw.error ?? raw.message ?? raw.code ?? 'render host error'))
  }
  return raw ?? {}
}

/** Resolución runtime de instrumento por pista (solo slot VST host-loaded). */
export function resolveBounceSlots(
  trackId: string,
  plugins: unknown,
): BounceSlotResolution {
  const loaded = getLoadedInstrumentForTrack(trackId)
  if (loaded?.slotId) {
    // Capas: todos los instrumentos cargados de la pista reciben el MIDI (igual que en Play).
    const capas = getLoadedInstrumentsForTrack(trackId)
      .map((p) => p.slotId)
      .filter((s) => s && s !== loaded.slotId)
    return capas.length ? { slotId: loaded.slotId, capas } : { slotId: loaded.slotId }
  }
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

/** Cambia (o añade) la extensión de una ruta. */
export function withExtension(ruta: string, ext: string): string {
  const sinExt = ruta.replace(/\.[^./\\]+$/, '')
  return `${sinExt}.${ext.replace(/^\./, '')}`
}

/** Nombre de archivo seguro en Windows a partir del nombre de una pista. */
export function nombreArchivoSeguro(nombre: string): string {
  const sinControl = [...nombre].map((c) => (c.charCodeAt(0) < 32 ? '_' : c)).join('')
  const limpio = sinControl.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return (limpio || 'Pista').slice(0, 80)
}

export type StemPlaneado = { trackId: string; nombre: string; stemIndex: number; path: string }

/**
 * Qué pistas salen como stem y con qué nombre. Sin lista explícita: las que suenan (respeta
 * mute/solo) y los buses (retornos de reverb, etc.). Nombres `NN - Pista.wav` en `<mezcla>-stems/`.
 */
export function planStems(
  state: Pick<DAWState, 'project'>,
  finalPath: string,
  stemTrackIds?: string[],
): StemPlaneado[] {
  const tracks = state.project?.tracks ?? []
  const pedidas = stemTrackIds?.length ? new Set(stemTrackIds) : null
  const suenan = new Set(detectarFinProyecto(state.project).pistasConContenido)
  const dir = `${finalPath.replace(/\.[^./\\]+$/, '')}-stems`
  const usados = new Set<string>()
  const out: StemPlaneado[] = []
  tracks.forEach((t, stemIndex) => {
    if (stemIndex >= MAX_STEMS) return
    const incluir = pedidas ? pedidas.has(t.id) : suenan.has(t.id) || t.tipo === 'bus'
    if (!incluir) return
    let base = `${String(out.length + 1).padStart(2, '0')} - ${nombreArchivoSeguro(t.nombre)}`
    while (usados.has(base.toLowerCase())) base += '_'
    usados.add(base.toLowerCase())
    out.push({ trackId: t.id, nombre: t.nombre, stemIndex, path: `${dir}/${base}.wav` })
  })
  return out
}

/** Ruta final del export con la extensión del formato (la del diálogo puede venir sin ella o con otra). */
async function resolveFinalPath(job: RenderJob): Promise<string> {
  const ext = RENDER_EXTENSION[job.format] ?? 'wav'
  if (job.outputPath) return withExtension(job.outputPath, ext)
  try {
    const dir = await window.electron?.recordingsDir?.()
    return dir ? `${dir}/bounce-${job.id}.${ext}` : `bounce-${job.id}.${ext}`
  } catch {
    return `bounce-${job.id}.${ext}`
  }
}

/** El host perdió el render en curso porque se reinició (proceso nuevo o caído). */
function esReinicioDelMotor(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e)
  return /No hay bounce activo|RenderIdle|HostNotReady|Plugin Host Process salió|stdin cerrado/i.test(m)
}

/** Texto para el usuario cuando falta el codificador. */
export const MENSAJE_FALTA_FFMPEG =
  'Para exportar en este formato hace falta el codificador (ffmpeg). Descárgalo desde el diálogo de exportación o exporta en WAV.'

/**
 * Bounce offline en el host nativo. Nunca deja el job colgado en 'rendering':
 * cualquier excepción (host reiniciado, escritura denegada…) lo marca 'failed'.
 */
export async function runNativeBounce(
  job: RenderJob,
  content: BounceContent,
  emit?: (nombre: string, payload: Record<string, unknown>) => void,
  dawState?: DAWState,
): Promise<RenderJob> {
  // U6: cualquier bounce (diálogo, IA, master pass, freeze) bloquea la app:
  // transporte, edición y atajos quedan deshabilitados hasta que termina.
  activarRenderLock()
  try {
    try {
      return await runNativeBounceUnsafe(job, content, emit, dawState)
    } catch (e) {
      // El motor se reinició a mitad del export (cambio de dispositivo, relevo del host): el proceso
      // nuevo no tiene el render en curso. Se espera a que esté listo y se repite una vez.
      if (!esReinicioDelMotor(e) || renderJobGet(job.id)?.status === 'cancelled') throw e
      emit?.('render.progress', { jobId: job.id, progress: 0 })
      await new Promise((r) => setTimeout(r, 1500))
      await window.electron?.pluginHostEnsure?.()
      try {
        return await runNativeBounceUnsafe(job, content, emit, dawState)
      } catch (e2) {
        if (!esReinicioDelMotor(e2)) throw e2
        throw new Error(
          'El motor de audio se reinició durante la exportación (por ejemplo, al cambiar de dispositivo). Vuelve a exportar cuando el audio esté estable.',
        )
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    renderJobUpdate(job.id, { status: 'failed', error: msg })
    emit?.('render.error', { jobId: job.id, message: msg })
    try {
      await window.electron?.pluginHostSend?.({ type: 'renderOfflineCancel' })
    } catch {
      /* host caído: nada que cancelar */
    }
    return renderJobGet(job.id) ?? { ...job, status: 'failed' as const, error: msg }
  } finally {
    desactivarRenderLock()
  }
}

async function runNativeBounceUnsafe(
  job: RenderJob,
  content: BounceContent,
  emit?: (nombre: string, payload: Record<string, unknown>) => void,
  dawState?: DAWState,
): Promise<RenderJob> {
  const startSec = job.start.segundos ?? 0
  const endSec = job.end.segundos ?? startSec + 1
  // Final automático: se deja sonar la cola (reverb/delay) y luego se recorta el silencio.
  const renderEndSec = job.autoEnd ? endSec + COLA_MAXIMA_SEGUNDOS : endSec
  const duration = Math.max(0.1, renderEndSec - startSec)
  const sr = job.sampleRate || 48000
  const totalFrames = Math.ceil(duration * sr)
  const bitDepth = (job.bitDepth === 24 || job.bitDepth === 32 ? job.bitDepth : 16) as WavBitDepth

  const finalPath = await resolveFinalPath(job)
  const hostWavPath = job.format === 'wav' ? finalPath : withExtension(finalPath, 'render.wav')

  renderJobUpdate(job.id, { status: 'rendering', progress: 0, outputPath: finalPath })
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
      endSec: renderEndSec,
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

  // Stems nativos: clip_player + grafo VST (mismo motor que Play).
  if (dawState?.project?.tracks?.length) {
    syncReaperTrackGraph(
      dawState.project.tracks,
      dawState.project.master?.plugins,
      dawState.project.routing,
    )
  }

  // Stems: el motor escribe un WAV por pista en la misma pasada (con inserts, fader y envíos).
  const stems = job.exportStems && dawState ? planStems(dawState, finalPath, job.stemTrackIds) : []
  if (stems.length) {
    const dir = stems[0]!.path.replace(/\/[^/]+$/, '')
    const r = await window.electron?.exportEnsureDir?.(dir)
    if (r && !r.ok) throw new Error(`No se pudo crear la carpeta de stems (${dir}): ${r.error ?? ''}`)
  }

  await hostSend({
    type: 'renderOfflineStart',
    outPath: hostWavPath,
    totalFrames,
    blockSize: BLOCK,
    sampleRate: sr,
    bitDepth,
    transparentMaster: job.transparentMaster === true,
    ...(stems.length
      ? { stemOuts: stems.map((s) => `${s.stemIndex}|${s.path}`).join(';'), stemTap: job.stemsTap ?? 'post' }
      : {}),
  })

  let autoPublicada = false
  try {
    // Clips de audio DESPUÉS de renderOfflineStart: el host hace clip_stop_all_scheduled()
    // al iniciar el bounce, así que programarlos antes dejaba las pistas de audio en silencio.
    await prepareNativeClipsForBounce(bounceContent, dawState, {
      startSec,
      durationSec: duration,
      sampleRate: sr,
    })
    // Las colas MIDI por slot drenan solo cuando renderMix procesa bloques:
    // con el renderer offline activo ningún bloque se consume en vivo.
    scheduleVstEvents(bounceContent, sr, startSec)

    let done = 0
    // Automatización de vol/paneo/parámetros: se muestrea un valor por bloque
    // (BLOCK=512 ≈ 10 ms de audio) y se publica al host entre pasos.
    const ctxAuto: ContextoAutomatizacionBounce | null =
      dawState?.project?.tracks?.length && hayAutomatizacion(dawState.project.tracks)
        ? {
            tracks: dawState.project.tracks,
            masterPlugins: dawState.project.master?.plugins,
            routing: dawState.project.routing,
            volumenHorneado: new Set(
              bounceContent.tracks.filter((t) => t.audioClips.length > 0).map((t) => t.trackId),
            ),
          }
        : null
    while (done < totalFrames) {
      if (renderJobGet(job.id)?.status === 'cancelled') {
        await hostSend({ type: 'renderOfflineCancel' })
        emit?.('render.cancelled', { jobId: job.id })
        return renderJobGet(job.id) ?? { ...job, status: 'cancelled' }
      }
      const frames = Math.min(BLOCK, totalFrames - done)
      if (ctxAuto) {
        publicarAutomatizacionBounce(ctxAuto, startSec + done / sr)
        autoPublicada = true
      }
      await hostSend({ type: 'renderOfflineStep', frames })

      done += frames
      const progress = done / totalFrames
      renderJobUpdate(job.id, {
        status: 'rendering',
        // El 90-100 % queda para recorte, normalización y codificación.
        progress: Math.min(90, Math.round(progress * 90)),
      })
      emit?.('render.progress', { jobId: job.id, progress: progress * 0.9 })
    }

    const finish = await hostSend({ type: 'renderOfflineFinish' })
    const path = String(finish.path ?? hostWavPath)
    const framesHost = typeof finish.frames === 'number' ? Number(finish.frames) : totalFrames
    const finishSr = typeof finish.sampleRate === 'number' ? Number(finish.sampleRate) : sr

    const bin = (await window.electron?.fileReadBinary?.(path)) as Uint8Array | undefined
    const pcm = bin ? decodeWav(bin) : null
    if (!pcm || pcm.channels.length === 0) {
      throw new Error(`El motor terminó el render pero el WAV no se pudo leer (${path}).`)
    }
    let channels = pcm.channels.length === 1 ? [pcm.channels[0]!, pcm.channels[0]!] : pcm.channels.slice(0, 2)

    // Recorte de la cola: se conserva lo que suena tras el último clip y medio segundo de silencio.
    let framesOut = channels[0]!.length || framesHost
    let reescribir = false
    if (job.autoEnd) {
      const finContenido = Math.round(((job.contentEndSec ?? endSec) - startSec) * finishSr)
      const keep = framesConCola(channels, finishSr, finContenido)
      if (keep < framesOut) {
        channels = channels.map((c) => c.subarray(0, keep))
        framesOut = keep
        reescribir = true
      }
    }

    let analysis = measureMixAnalysis(channels, finishSr)
    let loudness = framesOut > 1 ? analysis.loudness : measureLoudnessBs1770(channels, finishSr)
    let normalized = false
    let ganancia = false
    if (job.normalize === 'peak' || job.normalize === 'lufs') {
      const normalizeTarget = job.normalizeTargetDb ?? (job.normalize === 'lufs' ? -14 : -1)
      const gain = normalizeGainForTarget(analysis, job.normalize, normalizeTarget)
      channels = applyGainToChannels(channels, gain)
      analysis = measureMixAnalysis(channels, finishSr)
      loudness = analysis.loudness
      normalized = true
      ganancia = true
      reescribir = true
    }
    if (reescribir) {
      // Recorte puro de un WAV entero: sin dither (las muestras ya están cuantizadas). Con ganancia, sí.
      const wav = encodeWav(channels, finishSr, { bitDepth, dither: ganancia ? job.dither !== false : false })
      await saveBinaryOrThrow(path, wav)
    }
    renderJobUpdate(job.id, { status: 'rendering', progress: 93 })

    // Stems: mismo largo que la mezcla para que queden alineados al importarlos en otro DAW.
    const stemsPaths: string[] = []
    const stemsHost = Array.isArray(finish.stems) ? (finish.stems as Array<{ path?: string }>) : []
    for (const s of stems) {
      if (!stemsHost.some((h) => h.path === s.path)) continue
      if (reescribir && framesOut < framesHost) {
        const stemBin = (await window.electron?.fileReadBinary?.(s.path)) as Uint8Array | undefined
        const stemPcm = stemBin ? decodeWav(stemBin) : null
        if (stemPcm) {
          const recortado = stemPcm.channels.map((c) => c.subarray(0, framesOut))
          await saveBinaryOrThrow(s.path, encodeWav(recortado, finishSr, { bitDepth, dither: false }))
        }
      }
      stemsPaths.push(s.path)
    }
    renderJobUpdate(job.id, { status: 'rendering', progress: 96 })

    let outPathFinal = path
    if (job.format !== 'wav') {
      const api = window.electron
      if (!api?.audioEncode) throw new Error(MENSAJE_FALTA_FFMPEG)
      const r = await api.audioEncode(path, finalPath, job.format, {
        bitrate: job.bitrate,
        bitDepth,
        borrarEntrada: true,
      })
      if (!r?.ok) {
        const falta = /FFMPEG_MISSING/.test(r?.error ?? '')
        throw new Error(
          falta
            ? `${MENSAJE_FALTA_FFMPEG} El WAV quedó en ${path}.`
            : `No se pudo codificar a ${job.format.toUpperCase()}: ${r?.error ?? 'error desconocido'}. El WAV quedó en ${path}.`,
        )
      }
      outPathFinal = finalPath
    }

    const listenReport = buildAudioListenReport(analysis, {
      target: job.listenTarget,
      maxTruePeakDb: -1,
    })

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
    emit?.('render.completed', { jobId: job.id, path: outPathFinal, loudness, listenReport, stemsPaths })
    return completed
  } catch (e) {
    teardownNativeClipsAfterBounce()
    try {
      await hostSend({ type: 'renderOfflineCancel' })
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    teardownNativeClipsAfterBounce()
    // El bounce deja muestreados fader/paneo en el grafo nativo: restaurar los
    // valores base del proyecto para que la reproducción en vivo no herede curvas.
    if (autoPublicada && dawState?.project?.tracks?.length) {
      syncReaperTrackGraph(
        dawState.project.tracks,
        dawState.project.master?.plugins,
        dawState.project.routing,
      )
    }
  }
}

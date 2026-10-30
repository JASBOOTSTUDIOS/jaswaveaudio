/**
 * track.freeze / unfreeze — consolida stem a clip de audio y bypass VST.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { buildRuntimeBounceContent, runNativeBounce } from './bounce-service'
import { detectarFinProyecto } from '../../../shared/src/render/fin-proyecto'

export type FreezeResult = {
  ok: boolean
  message: string
  audioPath?: string
  clipId?: string
}

export async function freezeTrack(tienda: TiendaDAW, trackId: string): Promise<FreezeResult> {
  const st = tienda.obtenerEstado()
  const track = st.project.tracks.find((t) => t.id === trackId)
  if (!track) return { ok: false, message: 'Pista no encontrada' }
  if (track.frozen) return { ok: true, message: 'Ya estaba frozen', audioPath: track.comentario }

  // Se congela el stem PRE-fader de la pista (instrumento + inserts): el fader, el paneo y los envíos
  // siguen actuando sobre el audio congelado, y no se tocan mute/solo del proyecto. Master transparente:
  // la ganancia y el limitador de monitorización no se hornean en el clip.
  const finPista = detectarFinProyecto({
    bpm: st.project.bpm,
    tracks: [{ ...track, silenciada: false, soloActiva: false }],
  })
  if (finPista.vacio) return { ok: false, message: `«${track.nombre}» no tiene clips que congelar.` }
  const start = await tienda.executor.execute('render.start', {
    format: 'wav',
    bitDepth: 32,
    startSec: 0,
    endSec: finPista.finSegundos + 4,
    stemTrackIds: [trackId],
    stemsTap: 'pre',
    transparentMaster: true,
  })
  if (!start.success || !start.result) {
    return { ok: false, message: start.error?.message ?? 'render.start falló' }
  }
  const job = start.result as import('../../../shared/src/types/render').RenderJob
  const content = buildRuntimeBounceContent(tienda.obtenerEstado(), {
    startSec: 0,
    endSec: finPista.finSegundos + 4,
  })
  const done = await runNativeBounce(job, content, undefined, tienda.obtenerEstado())
  const audioPath = done.stemsPaths?.[0]
  if (done.status !== 'completed' || !audioPath) {
    return { ok: false, message: done.error ?? 'Bounce freeze falló' }
  }
  const bpm = Number(st.project.bpm?.valor) > 0 ? Number(st.project.bpm.valor) : 120
  const sr = job.sampleRate || 48000
  const segundos = (done.frames ?? Math.round((finPista.finSegundos + 4) * sr)) / sr
  // clip.create trabaja en beats.
  const duracionBeats = (segundos * bpm) / 60
  // Limpiar clips MIDI previos (el audio congelado los sustituye)
  const trackBeforeClips = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)
  for (const c of trackBeforeClips?.clips ?? []) {
    await tienda.executor.execute('clip.delete', { pistaId: trackId, clipId: c.id }).catch(() => undefined)
  }
  const clip = await tienda.executor.execute('clip.create', {
    pistaId: trackId,
    nombre: `${track.nombre} (frozen)`,
    inicio: 0,
    duracion: duracionBeats,
    sourceId: audioPath,
  })
  let clipId: string | undefined
  if (clip.success && clip.result && typeof clip.result === 'object') {
    const r = clip.result as { clipId?: string }
    if (typeof r.clipId === 'string' && r.clipId) clipId = r.clipId
  }
  if (!clipId) {
    const after = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)
    const last = (after?.clips ?? []).at(-1)
    if (last?.id) clipId = last.id
  }

  const fr = await tienda.executor.execute('track.freeze', {
    trackId,
    audioPath,
    clipId,
  })
  if (!fr.success) {
    return { ok: false, message: fr.error?.message ?? 'track.freeze falló' }
  }
  return {
    ok: true,
    message: `Frozen → ${audioPath}`,
    audioPath,
    clipId,
  }
}

export async function unfreezeTrack(tienda: TiendaDAW, trackId: string): Promise<FreezeResult> {
  const r = await tienda.executor.execute('track.unfreeze', { trackId })
  return {
    ok: r.success,
    message: r.success ? 'Unfrozen' : r.error?.message ?? 'falló',
  }
}

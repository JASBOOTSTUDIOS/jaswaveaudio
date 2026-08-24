/**
 * track.freeze / unfreeze — consolida stem a clip de audio y bypass VST.
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { buildRuntimeBounceContent, runNativeBounce } from './bounce-service'

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

  // Solo esta pista
  for (const t of st.project.tracks) {
    if (t.id === trackId) {
      if (t.silenciada) await tienda.executor.execute('track.toggleMute', { trackId: t.id })
      if (!t.soloActiva) await tienda.executor.execute('track.toggleSolo', { trackId: t.id })
    } else if (t.soloActiva) {
      await tienda.executor.execute('track.toggleSolo', { trackId: t.id })
    }
  }

  const endSec = Math.min(120, Math.max(8, estimateProjectEndSec(st)))
  const start = await tienda.executor.execute('render.start', {
    format: 'wav',
    startSec: 0,
    endSec,
    stems: false,
  })
  if (!start.success || !start.result) {
    return { ok: false, message: start.error?.message ?? 'render.start falló' }
  }
  const job = start.result as import('../../../shared/src/types/render').RenderJob
  const content = buildRuntimeBounceContent(tienda.obtenerEstado(), {
    startSec: 0,
    endSec,
  })
  const done = await runNativeBounce(job, content, undefined, tienda.obtenerEstado())
  if (done.status !== 'completed' || !done.outputPath) {
    return { ok: false, message: done.error ?? 'Bounce freeze falló' }
  }

  // Quitar solo
  const st2 = tienda.obtenerEstado()
  for (const t of st2.project.tracks) {
    if (t.soloActiva) await tienda.executor.execute('track.toggleSolo', { trackId: t.id })
  }

  const audioPath = done.outputPath
  // Limpiar clips MIDI previos (el audio congelado los sustituye)
  for (const c of track.clips ?? []) {
    await tienda.executor.execute('clip.delete', { pistaId: trackId, clipId: c.id }).catch(() => undefined)
  }
  const clip = await tienda.executor.execute('clip.create', {
    pistaId: trackId,
    nombre: `${track.nombre} (frozen)`,
    inicio: 0,
    duracion: endSec,
    sourceId: audioPath,
  })
  const clipId =
    clip.success && clip.result && typeof clip.result === 'object' && 'pistaId' in (clip.result as object)
      ? String((track.clips ?? []).length)
      : undefined

  const fr = await tienda.executor.execute('track.freeze', {
    trackId,
    audioPath,
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

function estimateProjectEndSec(st: ReturnType<TiendaDAW['obtenerEstado']>): number {
  let max = 8
  const bpmRaw = st.project.bpm
  const bpm =
    typeof bpmRaw === 'number'
      ? bpmRaw
      : typeof bpmRaw === 'object' && bpmRaw && 'valor' in bpmRaw
        ? Number((bpmRaw as { valor?: number }).valor) || 120
        : 120
  for (const t of st.project.tracks) {
    for (const c of t.clips ?? []) {
      const end = Number(c.inicio ?? 0) + Number(c.duracion ?? 0)
      max = Math.max(max, (end * 60) / bpm + 1)
    }
  }
  return max
}

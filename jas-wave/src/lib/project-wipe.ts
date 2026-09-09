/**
 * Wipe determinista del proyecto: borra pistas de usuario con IDs reales.
 * Evita clip.delete inventados sin clipId (falla típica del LLM).
 */

import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DawAction } from './ai-daw-agent'

export type WipeableTrack = { id: string; nombre: string; clips: number }

/** Pistas que se pueden borrar (no master). */
export function listWipableTracks(tienda: TiendaDAW): WipeableTrack[] {
  const tracks = tienda.obtenerEstado().project?.tracks ?? []
  return tracks
    .filter((t) => t.tipo !== 'master')
    .map((t) => ({
      id: t.id,
      nombre: String(t.nombre ?? t.id),
      clips: Array.isArray(t.clips) ? t.clips.length : 0,
    }))
}

/** Siguiente track.delete con ID real, o null si ya está limpio. */
export function buildNextWipeAction(tienda: TiendaDAW): DawAction | null {
  const next = listWipableTracks(tienda)[0]
  if (!next) return null
  return {
    type: 'track.delete',
    payload: { trackId: next.id, pistaId: next.id, nombre: next.nombre },
  }
}

/** Propuesta única de wipe (orquestador) para la tarjeta Aplicar. */
export function buildWipeProjectAction(opts?: { aplicar?: boolean }): DawAction {
  return {
    type: 'daw.wipeProject',
    payload: { aplicar: opts?.aplicar === true },
  }
}

/**
 * Si el pedido es wipe y las acciones son deletes rotos / incompletos,
 * sustituye por daw.wipeProject (IDs reales al ejecutar).
 */
export function ensureWipeProjectAction(
  actions: DawAction[],
  userText: string,
  isWipe: boolean,
): DawAction[] {
  if (!isWipe) return actions
  const hasWipe = actions.some((a) => a.type === 'daw.wipeProject')
  if (hasWipe) {
    return actions.filter((a) => a.type === 'daw.wipeProject').slice(0, 1)
  }
  const onlyDeletes = actions.every(
    (a) =>
      a.type === 'clip.delete' ||
      a.type === 'track.delete' ||
      a.type === 'track.list' ||
      a.type === 'selection.get' ||
      a.type === 'project.getSummary',
  )
  const brokenDeletes = actions.some((a) => {
    if (a.type !== 'clip.delete' && a.type !== 'track.delete') return false
    const p = a.payload ?? {}
    const trackId = String(p.trackId ?? p.pistaId ?? '').trim()
    const clipId = String(p.clipId ?? p.id ?? '').trim()
    if (a.type === 'track.delete') return !trackId || trackId === 'undefined'
    return !trackId || !clipId || trackId === 'undefined' || clipId === 'undefined'
  })
  if (actions.length === 0 || onlyDeletes || brokenDeletes) {
    return [buildWipeProjectAction({ aplicar: false })]
  }
  // Pedido wipe + basura creativa → forzar wipe
  if (/limpia|borra|vac[ií]a|wipe|clear/i.test(userText)) {
    return [buildWipeProjectAction({ aplicar: false })]
  }
  return actions
}

export type WipeResult = {
  deletedTracks: number
  deletedClips: number
  remaining: number
  messages: string[]
  success: boolean
}

/** Borra todas las pistas de usuario (master intacto). */
export async function executeProjectWipe(tienda: TiendaDAW): Promise<WipeResult> {
  const messages: string[] = []
  let deletedTracks = 0
  let deletedClips = 0
  // Releer en cada paso: los índices cambian al borrar
  for (let guard = 0; guard < 200; guard++) {
    const next = listWipableTracks(tienda)[0]
    if (!next) break
    deletedClips += next.clips
    const r = await tienda.executor.execute('track.delete', { trackId: next.id })
    if (!r.success) {
      messages.push(`✗ ${next.nombre}: ${r.error?.message ?? 'Error'}`)
      // Evitar bucle infinito si una pista no se puede borrar
      break
    }
    deletedTracks += 1
    messages.push(`✓ Eliminada «${next.nombre}»`)
  }
  const remaining = listWipableTracks(tienda).length
  return {
    deletedTracks,
    deletedClips,
    remaining,
    messages,
    success: remaining === 0,
  }
}

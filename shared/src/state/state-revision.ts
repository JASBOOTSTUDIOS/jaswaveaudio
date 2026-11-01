/**
 * Revisión ligera del DAWState para Agent Loop / conflict detection.
 * No es event sourcing: hash determinista de lo que el agente necesita detectar.
 */

import type { DAWState } from '../types/state'

function djb2(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = (h * 33) ^ input.charCodeAt(i)
  }
  return (h >>> 0).toString(16)
}

/** Fingerprint estable de tracks/clips/notas/plugins/BPM. */
export function computeStateRevision(state: DAWState): string {
  const project = state.project
  const tracks = project?.tracks ?? []
  const bits: string[] = [
    `bpm:${project?.bpm?.valor ?? 0}`,
    `ts:${(project as { timeSignature?: { numerador?: number; denominador?: number } })?.timeSignature?.numerador ?? 4}/${(project as { timeSignature?: { numerador?: number; denominador?: number } })?.timeSignature?.denominador ?? 4}`,
  ]
  for (const t of tracks) {
    const clips = t.clips ?? []
    const clipBits = clips
      .map((c) => {
        const notas = (c as { notas?: unknown[] }).notas
        const n = Array.isArray(notas) ? notas.length : 0
        return `${c.id}:${n}:${Number((c as { duracion?: number }).duracion ?? 0)}`
      })
      .join(';')
    const plugins = (t.plugins ?? [])
      .map((p) => `${p.id}:${String(p.descripcion ?? '').slice(0, 64)}`)
      .join(';')
    bits.push(`t:${t.id}:${clips.length}:${clipBits}:p[${plugins}]`)
  }
  const masterPlugins = (project?.master?.plugins ?? [])
    .map((p) => p.id)
    .join(',')
  bits.push(`m:${masterPlugins}`)
  return djb2(bits.join('|'))
}

/** Lee revision actual; si checksum vacío, calcula sin mutar. */
export function getStateRevision(state: DAWState): string {
  if (state.checksum && state.checksum.length > 0) return state.checksum
  return computeStateRevision(state)
}

/** Devuelve estado con checksum actualizado. */
export function withUpdatedStateRevision(state: DAWState): DAWState {
  const next = computeStateRevision(state)
  if (state.checksum === next) return state
  return { ...state, checksum: next }
}

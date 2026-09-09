/**
 * Resuelve pistas/instrumentos por lenguaje natural (nombre, rol, tags).
 * Si hay ambigüedad → formulario track_pick para el usuario.
 */

import type { ClarificationQuestion } from '@/src/lib/ai-clarify'
import type { DAWState } from '@jaswave/shared'
import type { Track } from '@jaswave/shared'

export type TrackHint = {
  label: string
  raw: string
}

export type TrackCandidate = {
  trackId: string
  trackName: string
  tipo: string
  rolHint?: string
  pluginName?: string
  score: number
}

export type TrackResolveResult = {
  trackId?: string
  trackName?: string
  ambiguous: boolean
  candidates: TrackCandidate[]
}

const ROLE_ALIASES: Record<string, string[]> = {
  drums: ['batería', 'bateria', 'drums', 'drum', 'percusión', 'percusion', 'kit'],
  bass: ['bajo', 'bass', 'bajo eléctrico', 'bajo electrico'],
  piano: ['piano'],
  keys: ['teclas', 'keys', 'teclado', 'keyboard', 'organo', 'órgano'],
  pad: ['pad', 'pads', 'atmosfera', 'atmósfera'],
  lead: ['lead', 'melodía', 'melodia', 'melody', 'solo'],
  guitar: ['guitarra', 'guitar'],
  vocal: ['voz', 'vocal', 'vocals', 'coro'],
  fx: ['fx', 'efectos'],
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
}

function isMidiCapable(t: Track): boolean {
  return t.tipo === 'midi' || t.tipo === 'instrumento' || t.tipo === 'audio'
}

function trackRoleFromTags(t: Track): string | undefined {
  for (const tag of t.tags ?? []) {
    const m = /^role:([\w-]+)$/i.exec(tag)
    if (m) return m[1]!.toLowerCase()
    const low = tag.toLowerCase()
    if (ROLE_ALIASES[low]) return low
  }
  return undefined
}

function primaryPluginName(t: Track): string | undefined {
  const p = t.plugins?.[0]
  return p?.nombre || undefined
}

function scoreTrack(t: Track, hintNorm: string, roleKey?: string): number {
  let score = 0
  const nameNorm = normalize(t.nombre)
  if (nameNorm === hintNorm) score += 100
  else if (nameNorm.includes(hintNorm) || hintNorm.includes(nameNorm)) score += 70
  else if (hintNorm.length >= 3 && nameNorm.split(/\s+/).some((w) => w.startsWith(hintNorm.slice(0, 4)))) {
    score += 40
  }

  const tagRole = trackRoleFromTags(t)
  if (roleKey && tagRole === roleKey) score += 85
  if (roleKey) {
    const aliases = ROLE_ALIASES[roleKey] ?? []
    if (aliases.some((a) => nameNorm.includes(normalize(a)))) score += 60
  }

  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    if (aliases.some((a) => normalize(a) === hintNorm || hintNorm.includes(normalize(a)))) {
      if (tagRole === role) score += 80
      if (aliases.some((a) => nameNorm.includes(normalize(a)))) score += 55
    }
  }

  const plugin = primaryPluginName(t)
  if (plugin && normalize(plugin).includes(hintNorm)) score += 35

  if (!isMidiCapable(t)) score -= 50
  return score
}

function detectRoleKey(hintNorm: string): string | undefined {
  for (const [role, aliases] of Object.entries(ROLE_ALIASES)) {
    if (role === hintNorm) return role
    if (aliases.some((a) => normalize(a) === hintNorm || hintNorm.includes(normalize(a)))) return role
  }
  return undefined
}

/** Extrae mención de pista/instrumento del mensaje del usuario. */
export function extractTrackHintFromUserText(text: string): TrackHint | null {
  const t = text.trim()
  if (!t || /\[Respuestas a clarificaci[oó]n\]/i.test(t)) return null

  const editRe =
    /(?:edit(?:a|ar|ame|emos)?|modifica(?:r)?|cambia(?:r)?|ajusta(?:r)?|arregla(?:r)?|actualiza(?:r)?|mejora(?:r)?|toca(?:r)?|reescribe(?:r)?)\s+(?:la\s+|el\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\s+(?:en|del|de la|para el|para la)\s|$|[,.!?]|$)/i
  const enRe = /(?:en|de|para)\s+(?:la\s+|el\s+|los\s+|las\s+)?(.+?)(?:\s+(?:comp[aá]s|bar|beat|clip|secci[oó]n)|[,.!?]|$)/i
  const pistaRe = /pista\s+(.+?)(?:[,.!?]|$)/i

  let raw = editRe.exec(t)?.[1]?.trim()
  if (!raw) raw = enRe.exec(t)?.[1]?.trim()
  if (!raw) raw = pistaRe.exec(t)?.[1]?.trim()

  if (!raw) {
    for (const aliases of Object.values(ROLE_ALIASES)) {
      for (const a of aliases) {
        if (new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t)) {
          return { label: a, raw: a }
        }
      }
    }
    return null
  }

  raw = raw.replace(/\b(clip|comp[aá]s|barra|secci[oó]n|parte|solo|solamente)\b.*$/i, '').trim()
  if (raw.length < 2) return null
  return { label: raw, raw }
}

export function resolveTrackHint(state: DAWState, hint: TrackHint): TrackResolveResult {
  const hintNorm = normalize(hint.label)
  const roleKey = detectRoleKey(hintNorm)
  const tracks = state.project?.tracks ?? []

  const scored: TrackCandidate[] = []
  for (const t of tracks) {
    const score = scoreTrack(t, hintNorm, roleKey)
    if (score < 30) continue
    scored.push({
      trackId: t.id,
      trackName: t.nombre,
      tipo: t.tipo,
      rolHint: trackRoleFromTags(t) ?? roleKey,
      pluginName: primaryPluginName(t),
      score,
    })
  }
  scored.sort((a, b) => b.score - a.score)

  if (scored.length === 0) {
    return { ambiguous: false, candidates: [] }
  }
  if (scored.length === 1 || scored[0]!.score >= scored[1]!.score + 25) {
    return {
      trackId: scored[0]!.trackId,
      trackName: scored[0]!.trackName,
      ambiguous: false,
      candidates: scored,
    }
  }
  const top = scored.filter((c) => c.score >= scored[0]!.score - 10).slice(0, 6)
  return { ambiguous: true, candidates: top }
}

export function buildTrackPickClarifications(
  candidates: TrackCandidate[],
  hintLabel: string,
): ClarificationQuestion[] {
  const options = candidates.map((c) => {
    const parts = [c.trackName]
    if (c.rolHint) parts.push(c.rolHint)
    if (c.pluginName) parts.push(c.pluginName)
    return `${parts.join(' · ')} (id=${c.trackId})`
  })
  return [
    {
      id: 'track_pick',
      question: `Varias pistas podrían ser «${hintLabel}». ¿Cuál quieres editar?`,
      options,
      allowCustom: false,
      multi: false,
    },
  ]
}

export function extractTrackIdFromClarifyAnswer(text: string): string | undefined {
  const m = /\(id=([\w-]+)\)/i.exec(text) || /\btrackId[=:\s]+([\w-]+)/i.exec(text)
  return m?.[1]
}

export function formatResolvedTrackContext(state: DAWState, trackId: string): string {
  const t = state.project?.tracks?.find((x) => x.id === trackId)
  if (!t) return `[Pista resuelta: id=${trackId}]`
  const midiClips = (t.clips ?? []).filter((c) => c.tipo === 'midi')
  const clipLines = midiClips
    .slice(0, 8)
    .map((c) => `  - clipId=${c.id} «${c.nombre}» beats ${c.inicio}-${Number(c.inicio) + Number(c.duracion)}`)
  return [
    `[Pista resuelta por el usuario: id=${t.id} «${t.nombre}» tipo=${t.tipo}]`,
    'OBLIGATORIO: usa pistaId/trackId=' + t.id + ' en midi.clip.md.* / midi.notes.*. NO track.create.',
    'Para editar solo una sección: midi.notes.patch { pistaId, rangeStart, rangeEnd, notas } (crea el clip si no hay uno en ese rango).',
    midiClips.length ? 'Clips MIDI en esta pista:' : 'Sin clips MIDI aún en esta pista.',
    ...clipLines,
  ].join('\n')
}

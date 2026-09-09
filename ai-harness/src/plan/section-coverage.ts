/**
 * Cobertura de secciones (marcadores × pistas MIDI).
 * Un hueco = la pista no tiene notas en el rango del marcador.
 */

import type { DAWState } from '@jaswave/shared'

export type SectionSpan = {
  name: string
  start: number
  end: number
}

export type SectionGap = {
  trackId: string
  trackName: string
  section: string
  start: number
  end: number
}

type ClipLike = {
  inicio?: number
  duracion?: number
  notas?: Array<{ inicio?: number; duracion?: number; pitch?: number }>
  notes?: Array<{ inicio?: number; duracion?: number }>
}

function clipNotes(clip: ClipLike): Array<{ inicio: number; duracion: number }> {
  const raw = clip.notas ?? clip.notes ?? []
  return raw.map((n) => ({
    inicio: Number(n.inicio) || 0,
    duracion: Number(n.duracion) || 0,
  }))
}

export function clipArrangeRange(clip: ClipLike): { start: number; end: number } {
  const start = Math.max(0, Number(clip.inicio) || 0)
  const notes = clipNotes(clip)
  const fromNotes = notes.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 0)
  const dur = Number(clip.duracion)
  const end = start + (Number.isFinite(dur) && dur > 0 ? dur : Math.max(fromNotes, 0))
  return { start, end }
}

export function clipCoversSection(clip: ClipLike, start: number, end: number): boolean {
  const span = Math.max(0, end - start)
  if (span <= 0) return false
  const r = clipArrangeRange(clip)
  const overlap = Math.min(r.end, end) - Math.max(r.start, start)
  const need = Math.min(span * 0.5, Math.max(1, Math.min(4, span)))
  if (overlap < need - 1e-6) return false
  const notes = clipNotes(clip)
  if (notes.length === 0) return false
  return notes.some((n) => {
    const abs = r.start + n.inicio
    return abs >= start - 1e-6 && abs < end - 1e-6
  })
}

function markerName(m: { nombre?: string; id?: string }): string {
  const raw = String(m.nombre ?? m.id ?? 'Sección')
  return raw.replace(/\s*\(\d+c\)\s*$/i, '').trim() || 'Sección'
}

/** Rangos [start, end) a partir de marcadores del proyecto (tiempo en beats). */
export function listSectionSpans(state: DAWState, songEndBeats?: number): SectionSpan[] {
  const markers = [...(state.project?.marcadores ?? [])].sort(
    (a, b) => Number(a.tiempo) - Number(b.tiempo),
  )
  if (!markers.length) return []
  const lastClipEnd = (state.project?.tracks ?? []).reduce((max, t) => {
    for (const c of t.clips ?? []) {
      const r = clipArrangeRange(c as ClipLike)
      if (r.end > max) max = r.end
    }
    return max
  }, 0)
  const fallbackEnd = songEndBeats ?? Math.max(lastClipEnd, Number(markers[markers.length - 1]?.tiempo) + 16)
  const spans: SectionSpan[] = []
  for (let i = 0; i < markers.length; i++) {
    const start = Math.max(0, Number(markers[i]!.tiempo) || 0)
    const next = markers[i + 1]
    const end = next ? Math.max(start, Number(next.tiempo) || 0) : Math.max(start + 4, fallbackEnd)
    if (end - start < 1) continue
    spans.push({ name: markerName(markers[i]!), start, end })
  }
  return spans
}

export function isMidiLikeTrack(tipo: string | undefined): boolean {
  return tipo === 'midi' || tipo === 'instrumento'
}

export function listSectionGaps(state: DAWState): SectionGap[] {
  const spans = listSectionSpans(state)
  if (!spans.length) return []
  const gaps: SectionGap[] = []
  for (const t of state.project?.tracks ?? []) {
    if (!isMidiLikeTrack(t.tipo)) continue
    const clips = (t.clips ?? []) as ClipLike[]
    for (const sec of spans) {
      const covered = clips.some((c) => clipCoversSection(c, sec.start, sec.end))
      if (!covered) {
        gaps.push({
          trackId: t.id,
          trackName: t.nombre || t.id,
          section: sec.name,
          start: sec.start,
          end: sec.end,
        })
      }
    }
  }
  return gaps
}

export function parseBeatsRangeFromTask(task: string): { start: number; end: number } | null {
  const m =
    /beats?\s*(\d+(?:\.\d+)?)\s*[–\-—a]+\s*(\d+(?:\.\d+)?)/i.exec(task) ||
    /\((\d+(?:\.\d+)?)\s*[–\-—]\s*(\d+(?:\.\d+)?)\)/.exec(task)
  if (!m) return null
  const start = Number(m[1])
  const end = Number(m[2])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

export function parseSectionNameFromTask(task: string): string | null {
  const m =
    /secci[oó]n\s+[«"']?([^»"'(·\n]+)/i.exec(task) ||
    /section\s+[«"']?([^»"'(·\n]+)/i.exec(task)
  const name = m?.[1]?.trim()
  return name || null
}

export function trackHasNotesInRange(
  track: { clips?: ClipLike[] },
  start: number,
  end: number,
): boolean {
  return (track.clips ?? []).some((c) => clipCoversSection(c, start, end))
}

export function formatSectionGapLine(g: SectionGap): string {
  return `«${g.trackName}» · ${g.section} (beats ${g.start}–${g.end})`
}

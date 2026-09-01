/**
 * Extrae StyleProfile desde un MidiClip — sin copiar notas crudas.
 */

import { extractGrooveFromNotes, type MidiClip, type MidiNote } from '@jaswave/shared'
import type {
  StyleFeel,
  StyleKitStats,
  StyleMotifContour,
  StyleProfile,
  StyleProfileSource,
  StyleRole,
  StyleSectionHint,
} from './types'

const KICK = new Set([35, 36])
const SNARE = new Set([37, 38, 40])
const HAT_CLOSED = new Set([42, 44])
const HAT_OPEN = new Set([46])
const CRASH = new Set([49, 57])
const RIDE = new Set([51, 59])
const TOM = new Set([41, 43, 45, 47, 48, 50])

export function inferStyleRole(trackName?: string, explicit?: string): StyleRole {
  const raw = `${explicit ?? ''} ${trackName ?? ''}`.toLowerCase()
  if (/bater|drum|perc|kit|bfd|powerdrum/.test(raw)) return 'drums'
  if (/bajo|bass/.test(raw)) return 'bass'
  if (/pad|atmos|ambient/.test(raw)) return 'pad'
  if (/lead|melod/.test(raw)) return 'lead'
  if (/guitar|gtr/.test(raw)) return 'guitar'
  if (/key|piano|keys/.test(raw)) return 'keys'
  if (/fx|effect/.test(raw)) return 'fx'
  return 'other'
}

function emptyGrid(): number[] {
  return Array.from({ length: 16 }, () => 0)
}

function classifyNotes(notes: MidiNote[]): StyleKitStats {
  const kickGrid16 = emptyGrid()
  const snareGrid16 = emptyGrid()
  let kick = 0
  let snare = 0
  let snareGhost = 0
  let hatClosed = 0
  let hatOpen = 0
  let crash = 0
  let ride = 0
  let tom = 0
  let other = 0
  let velSum = 0

  for (const n of notes) {
    const p = Math.round(n.pitch)
    const v = n.velocidad ?? 80
    velSum += v
    const step = Math.floor((((n.inicio % 4) + 4) % 4) / 0.25) % 16

    if (KICK.has(p)) {
      kick += 1
      kickGrid16[step] = (kickGrid16[step] ?? 0) + 1
    } else if (SNARE.has(p)) {
      snare += 1
      if (v < 55) snareGhost += 1
      else snareGrid16[step] = (snareGrid16[step] ?? 0) + 1
    } else if (HAT_CLOSED.has(p)) hatClosed += 1
    else if (HAT_OPEN.has(p)) hatOpen += 1
    else if (CRASH.has(p)) crash += 1
    else if (RIDE.has(p)) ride += 1
    else if (TOM.has(p)) tom += 1
    else other += 1
  }

  const bars = Math.max(1, notes.length ? Math.ceil(Math.max(...notes.map((n) => n.inicio + n.duracion)) / 4) : 1)
  const norm = (arr: number[]) => arr.map((c) => c / bars)

  return {
    kick,
    snare,
    snareGhost,
    hatClosed,
    hatOpen,
    crash,
    ride,
    tom,
    other,
    total: notes.length,
    avgVel: notes.length ? velSum / notes.length : 0,
    kickGrid16: norm(kickGrid16),
    snareGrid16: norm(snareGrid16),
  }
}

function extractMotif(notes: MidiNote[], clipDurBeats: number): StyleMotifContour {
  const melodic = notes
    .filter((n) => !KICK.has(Math.round(n.pitch)) && !SNARE.has(Math.round(n.pitch)) && !HAT_CLOSED.has(Math.round(n.pitch)) && !HAT_OPEN.has(Math.round(n.pitch)) && !CRASH.has(Math.round(n.pitch)) && !RIDE.has(Math.round(n.pitch)) && !TOM.has(Math.round(n.pitch)))
    .slice()
    .sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)

  const use = melodic.length >= 2 ? melodic : notes.slice().sort((a, b) => a.inicio - b.inicio)
  const intervals: number[] = []
  for (let i = 1; i < Math.min(use.length, 48); i++) {
    intervals.push(Math.round(use[i]!.pitch) - Math.round(use[i - 1]!.pitch))
  }
  const rhythm16 = use.slice(0, 32).map((n) => Math.round(n.inicio * 4) / 4)
  const pitches = use.map((n) => Math.round(n.pitch))
  const bars = Math.max(1, clipDurBeats / 4)
  return {
    intervals,
    rhythm16,
    pitchMin: pitches.length ? Math.min(...pitches) : 60,
    pitchMax: pitches.length ? Math.max(...pitches) : 72,
    notesPerBar: use.length / bars,
  }
}

function inferFeel(stats: StyleKitStats, notes: MidiNote[], rol: StyleRole): StyleFeel {
  if (notes.length < 4) return 'sparse'
  if (rol === 'drums') {
    const snareOn2or4 = (stats.snareGrid16[4] ?? 0) + (stats.snareGrid16[12] ?? 0)
    const snareOn3 = stats.snareGrid16[8] ?? 0
    const kickDense = stats.kick / Math.max(1, Math.ceil(notes.length / 8))
    if (snareOn3 > snareOn2or4 * 1.2 && stats.kick < stats.snare * 1.5) return 'halfTime'
    if ((stats.hatClosed + stats.hatOpen) / Math.max(1, stats.kick) > 3 && kickDense > 2) return 'full'
    if (stats.total < 12) return 'sparse'
    if ((stats.hatClosed + stats.hatOpen) > stats.kick * 4 && stats.tom > 2) return 'build'
    return snareOn2or4 >= snareOn3 ? 'full' : 'halfTime'
  }
  if (stats.total < 8) return 'sparse'
  return 'full'
}

function sectionHintsFromDensity(notes: MidiNote[], clipDur: number): StyleSectionHint[] {
  const bars = Math.max(1, Math.ceil(clipDur / 4))
  const hints: StyleSectionHint[] = []
  for (let b = 0; b < Math.min(bars, 16); b++) {
    const count = notes.filter((n) => n.inicio >= b * 4 && n.inicio < (b + 1) * 4).length
    if (count <= 2) hints.push('sparse')
    else if (count >= 14) hints.push('dense')
    else if (count >= 8) hints.push('build')
    else hints.push('sparse')
  }
  return hints
}

function buildSummary(p: {
  nombre: string
  rol: StyleRole
  bpm: number
  feel: StyleFeel
  stats: StyleKitStats
  tags: string[]
}): string {
  const g =
    p.rol === 'drums'
      ? `kick=${p.stats.kick} snare=${p.stats.snare} ghosts=${p.stats.snareGhost} hats=${p.stats.hatClosed + p.stats.hatOpen}`
      : `notas=${p.stats.total} vel≈${Math.round(p.stats.avgVel)}`
  return `${p.nombre}: ${p.rol} @ ${p.bpm} BPM, feel=${p.feel}, ${g}. Tags: ${p.tags.join(', ') || '—'}.`
}

export type ExtractStyleOpts = {
  nombre?: string
  tags?: string[]
  bpm: number
  rol?: StyleRole
  trackName?: string
  source?: StyleProfileSource
  scope?: 'project' | 'global'
  id?: string
}

/** Analiza un clip y devuelve un StyleProfile sin embeber MIDI. */
export function extractStyleProfile(clip: MidiClip, opts: ExtractStyleOpts): StyleProfile {
  const notes = clip.notas ?? []
  const rol = opts.rol ?? inferStyleRole(opts.trackName)
  const stats = classifyNotes(notes)
  const groove = extractGrooveFromNotes(notes, 0.25)
  groove.nombre = `groove:${opts.nombre ?? clip.nombre}`
  const motifContour = extractMotif(notes, Math.max(4, Number(clip.duracion) || 4))
  const feel = inferFeel(stats, notes, rol)
  const sectionHints = sectionHintsFromDensity(notes, Math.max(4, Number(clip.duracion) || 4))
  const tags = [...(opts.tags ?? [])]
  if (feel && !tags.includes(feel)) tags.push(feel)
  if (rol === 'drums' && !tags.includes('drums')) tags.push('drums')
  const now = Date.now()
  const nombre = opts.nombre?.trim() || clip.nombre || 'Estilo'
  const profile: StyleProfile = {
    id: opts.id ?? `style-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    nombre,
    rol,
    tags,
    bpm: opts.bpm || 120,
    feel,
    groove,
    stats,
    motifContour,
    sectionHints,
    source: opts.source,
    summaryText: '',
    scope: opts.scope ?? 'project',
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  profile.summaryText = buildSummary(profile)
  return profile
}

/** Seed Firmthm / Mesías (worship coro denso) — sin MIDI. */
export function seedMesiasWorshipDrumProfile(): StyleProfile {
  const kickGrid16 = emptyGrid()
  // 1, 1&, 2&, 3, 3&, 4& → steps 0, 2, 6, 8, 10, 14
  for (const s of [0, 2, 6, 8, 10, 14]) kickGrid16[s] = 1
  const snareGrid16 = emptyGrid()
  snareGrid16[4] = 1
  snareGrid16[12] = 1
  const now = Date.now()
  const stats: StyleKitStats = {
    kick: 48,
    snare: 24,
    snareGhost: 16,
    hatClosed: 56,
    hatOpen: 8,
    crash: 4,
    ride: 0,
    tom: 4,
    other: 0,
    total: 160,
    avgVel: 88,
    kickGrid16,
    snareGrid16,
  }
  const profile: StyleProfile = {
    id: 'style-seed-mesias-firmthm-drums',
    nombre: 'Mesías / Firmthm — coro drums',
    rol: 'drums',
    tags: ['worship', 'averly', 'mesias', 'firmthm', 'full', 'drums'],
    bpm: 72,
    feel: 'full',
    groove: {
      id: 'mesias-chorus',
      nombre: 'Mesías coro',
      stepBeats: 0.25,
      steps: Array.from({ length: 16 }, (_, i) => ({
        timing: 0,
        velocity: [0, 4, 8, 12].includes(i) ? 6 : i % 2 === 0 ? 2 : -4,
      })),
    },
    stats,
    motifContour: {
      intervals: [],
      rhythm16: [],
      pitchMin: 36,
      pitchMax: 49,
      notesPerBar: 18,
    },
    sectionHints: ['dense', 'dense', 'dense', 'dense'],
    source: { clipName: 'seed' },
    summaryText: '',
    scope: 'global',
    createdAt: now,
    updatedAt: now,
    version: 1,
  }
  profile.summaryText = buildSummary(profile)
  return profile
}

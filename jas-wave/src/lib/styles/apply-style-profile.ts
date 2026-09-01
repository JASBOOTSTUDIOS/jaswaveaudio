/**
 * Aplicar StyleProfile como priors — genera / enriquece notas SIN copiar el MIDI origen.
 */

import { applyGroove, type MidiNote } from '@jaswave/shared'
import type { StyleProfile } from './types'

const KICK = 36
const SNARE = 38
const CHH = 42
const OHH = 46
const CRASH = 49
const RIDE = 51

function mk(
  id: string,
  pitch: number,
  inicio: number,
  velocidad: number,
  duracion = 0.12,
): MidiNote {
  return {
    id,
    pitch,
    velocidad,
    inicio,
    duracion,
    canal: 0,
    presion: 0,
    seleccionada: false,
    source: 'ai',
  }
}

function noteNear(notes: MidiNote[], t: number, pitch: number, tol = 0.08): boolean {
  return notes.some((n) => Math.round(n.pitch) === pitch && Math.abs(n.inicio - t) < tol)
}

/**
 * Construye o enriquece un patrón de batería a partir del perfil (grids + feel).
 * Si `existing` está vacío, genera un groove nuevo; si no, añade ghosts/hats/crashes según priors.
 */
export function applyStyleProfileToNotes(
  profile: StyleProfile,
  opts: { bars: number; existing?: MidiNote[]; seed?: number },
): MidiNote[] {
  const bars = Math.max(1, opts.bars)
  const existing = [...(opts.existing ?? [])]
  const seed = opts.seed ?? 42
  let seq = 0
  const nextId = (p: string) => `${p}-${profile.id.slice(-6)}-${seq++}`

  if (profile.rol === 'drums') {
    const out: MidiNote[] = existing.length ? [...existing] : []
    const generate = existing.length === 0

    for (let bar = 0; bar < bars; bar++) {
      const base = bar * 4
      if (generate) {
        if (profile.feel === 'halfTime' || profile.feel === 'sparse') {
          out.push(mk(nextId('k'), KICK, base, 100, 0.35))
          out.push(mk(nextId('s'), SNARE, base + 2, profile.feel === 'sparse' ? 70 : 105, 0.3))
          for (let i = 0; i < 8; i++) {
            out.push(mk(nextId('h'), CHH, base + i * 0.5, 52 + (i % 2) * 4, 0.15))
          }
        } else if (profile.feel === 'build') {
          out.push(mk(nextId('k'), KICK, base, 100, 0.25))
          out.push(mk(nextId('k'), KICK, base + 2, 98, 0.25))
          for (let i = 0; i < 16; i++) {
            out.push(mk(nextId('h'), CHH, base + i * 0.25, 60 + (i % 4 === 0 ? 10 : 0), 0.1))
          }
        } else {
          // full — usar kickGrid16 / snareGrid16 del perfil
          for (let s = 0; s < 16; s++) {
            const t = base + s * 0.25
            if ((profile.stats.kickGrid16[s] ?? 0) > 0.15) {
              out.push(mk(nextId('k'), KICK, t, s % 8 === 0 ? 112 : 98, 0.18))
            }
            if ((profile.stats.snareGrid16[s] ?? 0) > 0.15) {
              out.push(mk(nextId('s'), SNARE, t, 114, 0.22))
            }
          }
          for (let i = 0; i < 8; i++) {
            const open = i === 7
            out.push(mk(nextId('h'), open ? OHH : CHH, base + i * 0.5, open ? 86 : 70, 0.14))
          }
        }
        if (bar % 4 === 0) out.push(mk(nextId('c'), CRASH, base, 118, 1.0))
      }

      // Ghosts en «e» de cada negra (prior worship / Firmthm)
      if (profile.stats.snareGhost > 0 || profile.tags.some((t) => /worship|averly|mesias|ghost/i.test(t))) {
        for (const off of [0.25, 1.25, 2.25, 3.25]) {
          const t = base + off
          if (!noteNear(out, t, SNARE)) {
            out.push(mk(nextId('gh'), SNARE, t, 36 + (bar % 3) * 2, 0.08))
          }
        }
      }
      if (profile.feel === 'halfTime' && !generate) {
        // asegurar ride o hats suaves
        for (let i = 0; i < 4; i++) {
          const t = base + i
          if (!noteNear(out, t, RIDE) && !noteNear(out, t, CHH)) {
            out.push(mk(nextId('r'), RIDE, t, 72, 0.4))
          }
        }
      }
    }

    const grooved = applyGroove(out, profile.groove.id, { strength: 0.35, seed })
    // applyGroove no encuentra id custom — aplicar steps manualmente si hace falta
    if (!grooved.some((n) => n.metadata?.grooveId)) {
      return applyExtractedGroove(out, profile, seed)
    }
    return grooved.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
  }

  // Melódico / other: reescribir densidades con contorno relativo (nueva melodía)
  const root = Math.round((profile.motifContour.pitchMin + profile.motifContour.pitchMax) / 2)
  const intervals = profile.motifContour.intervals.length
    ? profile.motifContour.intervals
    : [0, 2, -1, 2, 0, -2, 3, -1]
  const rhythm =
    profile.motifContour.rhythm16.length >= 2
      ? profile.motifContour.rhythm16
      : Array.from({ length: 8 }, (_, i) => i * 0.5)
  const out: MidiNote[] = []
  let pitch = root
  const patternLen = Math.min(16, Math.max(4, intervals.length))
  for (let bar = 0; bar < bars; bar++) {
    for (let i = 0; i < patternLen; i++) {
      const localT = rhythm[i % rhythm.length]! % 4
      const t = bar * 4 + localT
      pitch = Math.max(36, Math.min(96, pitch + (intervals[i % intervals.length] ?? 0)))
      // Variación por seed: invertir cada N
      const varPitch = pitch + ((seed + bar + i) % 3 === 0 ? 12 : 0) - ((seed + i) % 5 === 0 ? 12 : 0)
      out.push(mk(nextId('m'), Math.max(36, Math.min(96, varPitch)), t, 88 + (i % 4) * 4, 0.35))
    }
  }
  return out.sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
}

function applyExtractedGroove(notes: MidiNote[], profile: StyleProfile, seed: number): MidiNote[] {
  const steps = profile.groove.steps
  if (!steps.length) return notes
  const stepBeats = profile.groove.stepBeats || 0.25
  let i = 0
  return notes.map((n) => {
    const idx = Math.floor(Math.max(0, n.inicio) / stepBeats) % steps.length
    const step = steps[idx]!
    const jitter = ((seed + i++) % 7) * 0.0005 - 0.0015
    return {
      ...n,
      inicio: Math.max(0, n.inicio + step.timing * 0.35 + jitter),
      velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad + step.velocity * 0.35))),
    }
  })
}

/** Comprueba que apply no es un copy-paste de pitches del origen. */
export function pitchesDifferEnough(a: number[], b: number[], minDistinctRatio = 0.3): boolean {
  if (!a.length || !b.length) return true
  const setB = new Set(b)
  let same = 0
  for (const p of a) if (setB.has(p)) same += 1
  return same / a.length < 1 - minDistinctRatio
}

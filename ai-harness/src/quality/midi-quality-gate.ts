/**
 * Quality gate MIDI (heurística IA, no validador de dominio).
 */

import type { DAWState } from '@jaswave/shared'
import { isMidiLikeTrack } from '../plan/section-coverage'
import type { QualityGateResult, QualityVerdict } from './types'

export type MidiQualityInput = {
  state: DAWState
  mutatedMidi?: boolean
  builtProject?: boolean
  pluginGuides?: Array<{
    trackId: string
    pluginName: string
    role: string
    trackRole?: string
    chromatic: boolean
    range: { lo: number; hi: number }
    keyswitchPitches?: number[]
    drumMapPitches?: number[]
  }>
}

const GM_DRUM = new Set([35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 49, 51, 53, 54, 56])

function clipPitches(clip: { notas?: Array<{ pitch?: number }> }): number[] {
  return (clip.notas ?? []).map((n) => Math.round(Number(n.pitch))).filter((p) => Number.isFinite(p))
}

export function evaluateMidiQuality(input: MidiQualityInput): QualityGateResult {
  const findings: QualityGateResult['findings'] = []
  const state = input.state
  const guides = new Map((input.pluginGuides ?? []).map((g) => [g.trackId, g]))
  const midiTracks = (state.project?.tracks ?? []).filter((t) => isMidiLikeTrack(t.tipo))

  for (const t of midiTracks) {
    const clips = t.clips ?? []
    const notes = clips.reduce((n, c) => n + ((c as { notas?: unknown[] }).notas?.length ?? 0), 0)
    const label = t.nombre || t.id
    const guide = guides.get(t.id)
    const trackRole =
      guide?.trackRole ||
      (t.tags ?? [])
        .map((x) => String(x))
        .find((x) => x.startsWith('role:'))
        ?.slice(5)

    if (notes > 0 && (t.plugins ?? []).length === 0 && (input.builtProject || input.mutatedMidi)) {
      findings.push({
        verdict: 'fail',
        code: 'vst-missing',
        message: `Pista «${label}» tiene MIDI pero no hay VST/instrumento en la cadena.`,
      })
    }

    if (guide && notes > 0) {
      const pitches: number[] = []
      for (const c of clips) pitches.push(...clipPitches(c as { notas?: Array<{ pitch?: number }> }))
      const out = pitches.filter((p) => p < guide.range.lo || p > guide.range.hi)
      if (out.length >= Math.max(2, Math.ceil(pitches.length * 0.15))) {
        findings.push({
          verdict: 'fail',
          code: 'midi-out-of-range',
          message: `«${label}»: ${out.length} notas fuera del rango MIDI ${guide.range.lo}–${guide.range.hi} de «${guide.pluginName}».`,
        })
      }
      const ks = new Set(guide.keyswitchPitches ?? [])
      if (ks.size) {
        let ksMelodic = 0
        for (const c of clips) {
          const arr = (c as { notas?: Array<{ pitch?: number; duracion?: number }> }).notas ?? []
          for (const n of arr) {
            const p = Math.round(Number(n.pitch))
            if (!ks.has(p)) continue
            if (Number(n.duracion) >= 0.35) ksMelodic++
          }
        }
        if (ksMelodic >= 2) {
          findings.push({
            verdict: 'fail',
            code: 'midi-keyswitch-as-note',
            message: `«${label}»: ${ksMelodic} notas usan pitches de keyswitch con duración melódica — no dejes keyswitches sonando como melodía.`,
          })
        }
      }
      const drumRole = (guide.role === 'drums' || trackRole === 'drums') && !guide.chromatic
      if (drumRole && pitches.length >= 8) {
        const map = new Set(guide.drumMapPitches?.length ? guide.drumMapPitches : [...GM_DRUM])
        const unique = [...new Set(pitches)]
        const off = unique.filter((p) => !map.has(p))
        if (off.length >= Math.max(4, Math.ceil(unique.length * 0.4))) {
          findings.push({
            verdict: 'fail',
            code: 'midi-drum-off-map',
            message: `«${label}» parece kit pero hay ${off.length} pitches fuera del mapa de batería.`,
          })
        }
      }
    }

    for (const c of clips) {
      const clip = c as { id?: string; nombre?: string; duracion?: number; notas?: Array<{ inicio?: number; duracion?: number }> }
      const notesArr = clip.notas ?? []
      const clipDur = Number(clip.duracion)
      if (!notesArr.length || !Number.isFinite(clipDur) || clipDur <= 0) {
        if ((input.mutatedMidi || input.builtProject) && clipDur > 0 && notesArr.length === 0) {
          findings.push({
            verdict: 'fail',
            code: 'midi-empty-clip',
            message: `Clip vacío «${clip.nombre || c.id}» en «${label}».`,
          })
        }
        continue
      }
      const overflow = notesArr.filter((n) => Number(n.inicio) + Number(n.duracion) > clipDur + 0.25)
      if (overflow.length >= 3) {
        findings.push({
          verdict: 'warning',
          code: 'clip-notes-outside',
          message: `Clip «${clip.nombre || c.id}» en «${label}»: ${overflow.length} notas se salen del clip.`,
        })
      }
      if (input.mutatedMidi || input.builtProject) {
        const dens = notesArr.length / clipDur
        const name = `${label} / ${clip.nombre || c.id}`
        const roleGuess = (trackRole || label).toLowerCase()
        const isDrums = /bater|drum|perc/.test(roleGuess)
        const isBass = /bajo|bass/.test(roleGuess)
        const isPad = /pad|string|atm/.test(roleGuess)
        if (isDrums && dens < 1.2 && clipDur >= 8) {
          findings.push({
            verdict: 'fail',
            code: 'midi-skeleton-drums',
            message: `«${name}»: densidad ${dens.toFixed(2)}/beat — esqueleto.`,
          })
        } else if (isBass && dens < 0.35 && clipDur >= 8) {
          findings.push({
            verdict: 'fail',
            code: 'midi-skeleton-bass',
            message: `«${name}»: densidad ${dens.toFixed(2)}/beat — bajo casi vacío.`,
          })
        } else if (isPad && notesArr.length <= 4 && clipDur >= 16) {
          findings.push({
            verdict: 'warning',
            code: 'midi-skeleton-pad',
            message: `«${name}»: acorde estático de ${notesArr.length} notas en ${clipDur} beats.`,
          })
        } else if (!isDrums && !isBass && dens < 0.2 && clipDur >= 16 && notesArr.length < 8) {
          findings.push({
            verdict: 'warning',
            code: 'midi-skeleton',
            message: `«${name}»: solo ${notesArr.length} notas en ${clipDur} beats.`,
          })
        }
      }
    }
  }

  const verdict: QualityVerdict = findings.some((f) => f.verdict === 'fail')
    ? 'fail'
    : findings.some((f) => f.verdict === 'warning')
      ? 'warning'
      : 'pass'
  return { verdict, findings }
}

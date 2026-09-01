import type { GeneratedNote } from '../midi-song-generator'
import type { InstrumentRole } from '../plugin-knowledge'
import type { MidiValidationIssue } from './types'

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

const ROLE_RANGE: Record<string, { lo: number; hi: number }> = {
  drums: { lo: 35, hi: 81 },
  percussion: { lo: 35, hi: 81 },
  bass: { lo: 28, hi: 55 },
  guitar: { lo: 40, hi: 76 },
  piano: { lo: 36, hi: 84 },
  keys: { lo: 36, hi: 84 },
  pad: { lo: 48, hi: 84 },
  lead: { lo: 57, hi: 93 },
  strings: { lo: 48, hi: 88 },
  choir: { lo: 48, hi: 84 },
  synth: { lo: 36, hi: 96 },
  fx: { lo: 0, hi: 127 },
}

function pc(pitch: number): number {
  return ((pitch % 12) + 12) % 12
}

export function validateMidiClip(opts: {
  notes: GeneratedNote[]
  rol: InstrumentRole | string
  keyRoot: number
  scale: 'major' | 'minor'
  trackName: string
}): MidiValidationIssue[] {
  const issues: MidiValidationIssue[] = []
  const { notes, rol, keyRoot, scale, trackName } = opts
  if (notes.length === 0) {
    issues.push({
      severity: 'error',
      track: trackName,
      code: 'empty',
      message: `«${trackName}» no tiene notas`,
    })
    return issues
  }

  const range = ROLE_RANGE[rol] ?? { lo: 24, hi: 96 }
  const outOfRange = notes.filter((n) => n.pitch < range.lo || n.pitch > range.hi)
  if (outOfRange.length > notes.length * 0.35 && rol !== 'drums' && rol !== 'fx') {
    issues.push({
      severity: 'warn',
      track: trackName,
      code: 'range',
      message: `«${trackName}» (${rol}): ${outOfRange.length} notas fuera de ${range.lo}–${range.hi}`,
    })
  }

  if (rol !== 'drums' && rol !== 'percussion' && rol !== 'fx') {
    const allowed = new Set((scale === 'minor' ? MINOR : MAJOR).map((i) => (keyRoot + i) % 12))
    const off = notes.filter((n) => !allowed.has(pc(n.pitch)))
    if (off.length > notes.length * 0.45) {
      issues.push({
        severity: 'warn',
        track: trackName,
        code: 'scale',
        message: `«${trackName}»: muchas notas fuera de la escala (${off.length}/${notes.length})`,
      })
    }
  }

  if (rol === 'bass' || rol === 'lead') {
    const sorted = [...notes].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch)
    let overlaps = 0
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!
      const cur = sorted[i]!
      if (prev.pitch === cur.pitch && cur.inicio < prev.inicio + prev.duracion - 0.02) overlaps += 1
    }
    if (overlaps > 8) {
      issues.push({
        severity: 'warn',
        track: trackName,
        code: 'overlap',
        message: `«${trackName}»: ${overlaps} solapes en el mismo pitch`,
      })
    }
  }

  return issues
}

export function validateBuildNotes(
  clips: Array<{ trackName: string; rol: string; notes: GeneratedNote[] }>,
  keyRoot: number,
  scale: 'major' | 'minor',
): MidiValidationIssue[] {
  return clips.flatMap((c) =>
    validateMidiClip({ notes: c.notes, rol: c.rol, keyRoot, scale, trackName: c.trackName }),
  )
}

/**
 * Operaciones del piano roll (G3) sobre las notas locales: tijera, mute, transformaciones musicales,
 * selección por tono y guía de escala. Puras: el componente aplica el resultado y lo persiste con
 * `midi.notes.set` (un paso de undo por operación).
 */

import type { MidiNote } from '../../../shared/src/types/clips'
import {
  humanizeNotes,
  invertPitches,
  makeLegato,
  makeStaccato,
  reverseInTime,
  timeStretchNotes,
} from '../../../shared/src/midi/note-ops'
import { pitchInScale, snapPitchToScale, type ScaleType } from '../../../shared/src/midi/scale'

export type NotaPR = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal?: number
  mute?: boolean
}

/** Largo mínimo de cada trozo al cortar (1/64 de negra). */
const MIN_TROZO = 1 / 64

/**
 * Corta en `beat` las notas que lo cruzan. Con `ids` solo esas; con `pitchMin/pitchMax` solo las de ese
 * rango (arrastre vertical de la tijera). El trozo derecho recibe un id nuevo y hereda velocidad y mute.
 */
export function cortarNotas<T extends NotaPR>(
  notas: T[],
  beat: number,
  opts: { ids?: ReadonlySet<string>; pitchMin?: number; pitchMax?: number },
  nuevoId: () => string,
): { notas: T[]; cortadas: number; nuevosIds: string[] } {
  const out: T[] = []
  const nuevosIds: string[] = []
  let cortadas = 0
  for (const n of notas) {
    const fin = n.inicio + n.duracion
    const cruza = beat > n.inicio + MIN_TROZO && beat < fin - MIN_TROZO
    const enRango =
      (!opts.ids || opts.ids.has(n.id)) &&
      (opts.pitchMin == null || n.pitch >= opts.pitchMin) &&
      (opts.pitchMax == null || n.pitch <= opts.pitchMax)
    if (!cruza || !enRango) {
      out.push(n)
      continue
    }
    cortadas++
    const id = nuevoId()
    nuevosIds.push(id)
    out.push({ ...n, duracion: beat - n.inicio })
    out.push({ ...n, id, inicio: beat, duracion: fin - beat })
  }
  return { notas: out, cortadas, nuevosIds }
}

/** Si todas las notas indicadas están silenciadas se activan; si no, se silencian todas. */
export function alternarMute<T extends NotaPR>(notas: T[], ids: ReadonlySet<string>): T[] {
  const objetivo = notas.filter((n) => ids.has(n.id))
  if (!objetivo.length) return notas
  const mute = !objetivo.every((n) => n.mute === true)
  return notas.map((n) => (ids.has(n.id) ? { ...n, mute } : n))
}

/** Ids de todas las notas de un tono (Alt+clic en el teclado). */
export function idsDelTono(notas: readonly NotaPR[], pitch: number): string[] {
  return notas.filter((n) => n.pitch === pitch).map((n) => n.id)
}

export type TransformacionPR = 'legato' | 'staccato' | 'humanize' | 'reverse' | 'invert' | 'stretchDouble' | 'stretchHalf'

export const TRANSFORMACIONES_PR: ReadonlyArray<{ id: TransformacionPR; nombre: string; atajo: string }> = [
  { id: 'legato', nombre: 'Legato', atajo: 'Alt+L' },
  { id: 'staccato', nombre: 'Staccato', atajo: 'Alt+S' },
  { id: 'humanize', nombre: 'Humanizar', atajo: 'Alt+H' },
  { id: 'reverse', nombre: 'Invertir en el tiempo', atajo: 'Alt+R' },
  { id: 'invert', nombre: 'Invertir tonos', atajo: 'Alt+I' },
  { id: 'stretchDouble', nombre: 'Duración ×2', atajo: 'Alt+2' },
  { id: 'stretchHalf', nombre: 'Duración ÷2', atajo: 'Alt+1' },
]

/** Humanizado sutil: ±0,02 beats y ±8 de velocidad. */
export const HUMANIZE_DEFECTO = { timingAmount: 0.02, velocityAmount: 8 }

/**
 * Aplica una transformación a las notas seleccionadas (o a todas si no hay selección), conservando los
 * campos locales (`mute`, `canal`). `seed` hace el humanizado reproducible (la IA y el undo dan lo mismo).
 */
export function transformarNotas<T extends NotaPR>(
  op: TransformacionPR,
  notas: T[],
  ids: ReadonlySet<string>,
  opts: { seed?: number; timingAmount?: number; velocityAmount?: number } = {},
): T[] {
  const sel = ids.size ? [...ids] : undefined
  const comoMidi = notas as unknown as MidiNote[]
  let r: MidiNote[]
  switch (op) {
    case 'legato':
      r = makeLegato(comoMidi, sel)
      break
    case 'staccato':
      r = makeStaccato(comoMidi, 0.5, sel)
      break
    case 'humanize':
      r = humanizeNotes(comoMidi, {
        seed: opts.seed ?? 1,
        timingAmount: opts.timingAmount ?? HUMANIZE_DEFECTO.timingAmount,
        velocityAmount: opts.velocityAmount ?? HUMANIZE_DEFECTO.velocityAmount,
        noteIds: sel,
      })
      break
    case 'reverse':
      r = reverseInTime(comoMidi, sel)
      break
    case 'invert':
      r = invertPitches(comoMidi, sel)
      break
    case 'stretchDouble':
      r = timeStretchNotes(comoMidi, 2, sel)
      break
    case 'stretchHalf':
      r = timeStretchNotes(comoMidi, 0.5, sel)
      break
  }
  // note-ops puede añadir `source`/`metadata`: se vuelve al formato local sin perder `mute`.
  return r.map((n) => {
    const previa = notas.find((x) => x.id === n.id)
    return {
      ...(previa ?? ({} as T)),
      id: n.id,
      pitch: Math.max(0, Math.min(127, Math.round(n.pitch))),
      inicio: Math.max(0, n.inicio),
      duracion: Math.max(MIN_TROZO, n.duracion),
      velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad))),
    }
  })
}

// ── Guía de escala ───────────────────────────────────────────────────────────

export type EscalaPR = { raiz: number; tipo: ScaleType }

export const NOMBRES_RAIZ = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const TIPOS_ESCALA: ReadonlyArray<{ id: ScaleType; nombre: string }> = [
  { id: 'major', nombre: 'Mayor' },
  { id: 'minor', nombre: 'Menor' },
  { id: 'dorian', nombre: 'Dórica' },
  { id: 'phrygian', nombre: 'Frigia' },
  { id: 'lydian', nombre: 'Lidia' },
  { id: 'mixolydian', nombre: 'Mixolidia' },
  { id: 'pentatonic_major', nombre: 'Pentatónica mayor' },
  { id: 'pentatonic_minor', nombre: 'Pentatónica menor' },
  { id: 'blues', nombre: 'Blues' },
]

export function enEscala(pitch: number, escala: EscalaPR | null): boolean {
  return !escala || pitchInScale(pitch, escala.raiz, escala.tipo)
}

/** Con «ajustar a escala» activo, el tono cae en el grado más cercano de la escala. */
export function ajustarAEscala(pitch: number, escala: EscalaPR | null, activo: boolean): number {
  if (!escala || !activo) return pitch
  return snapPitchToScale(pitch, escala.raiz, escala.tipo)
}

/**
 * Transpone `semitonos` y, con ajuste a escala, avanza por grados de la escala (nunca cae fuera ni se
 * queda en el mismo tono).
 */
export function transponerEnEscala(pitch: number, semitonos: number, escala: EscalaPR | null, activo: boolean): number {
  const destino = Math.max(0, Math.min(127, pitch + semitonos))
  if (!escala || !activo || semitonos === 0) return destino
  const paso = semitonos > 0 ? 1 : -1
  let p = destino
  while (p >= 0 && p <= 127 && !pitchInScale(p, escala.raiz, escala.tipo)) p += paso
  return p < 0 || p > 127 ? pitch : p
}

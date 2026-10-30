/**
 * Snap de línea de tiempo compartido (arrange, transporte, piano roll, etc.).
 * El selector del edit-toolbar define la profundidad de anclaje del playhead.
 */

import { snapBeatToDivision } from '../../../shared/src/midi/grid'

/** Sentinel: anclar a límite de compás (usa beatsPerBar de la firma). */
export const SNAP_BAR = -1

export const TIMELINE_SNAP_OPTIONS = [
  { label: 'Off (Sin encaje)', value: 0 },
  { label: '1 Compás (1 Bar)', value: SNAP_BAR },
  { label: '1/2 nota', value: 2 },
  { label: '1/4 nota (Beat)', value: 1 },
  { label: '1/8 nota', value: 0.5 },
  { label: '1/16 nota', value: 0.25 },
  { label: '1/32 nota', value: 0.125 },
  { label: '1/64 nota', value: 0.0625 },
  { label: '1/128 nota', value: 0.03125 },
] as const

export type TimelineSnapValor = (typeof TIMELINE_SNAP_OPTIONS)[number]['value']

export type SeekSnapOpts = {
  /** Imán del playhead (transporte). Default true. */
  playheadSnap?: boolean
  /** Snap de proyecto activo. */
  snapEnabled?: boolean
  /** División en beats (SNAP_BAR=compás, 1=beat, 0.25=1/16…). 0 = off. */
  snapValor?: number
  /** Numerador de la firma (para SNAP_BAR). Default 4. */
  beatsPerBar?: number
}

/**
 * Resuelve snapValor del toolbar a beats de división.
 * SNAP_BAR (-1) o 4 legado (ex-opción «1 Compás») → beatsPerBar.
 * 0 → sin snap; resto → valor en beats.
 */
export function resolveSnapDivision(snapValor: number, beatsPerBar = 4): number {
  if (snapValor === SNAP_BAR || snapValor === 4) return Math.max(1, beatsPerBar)
  if (!(snapValor > 0)) return 0
  return snapValor
}

/** Valor a mostrar en el <select> (normaliza 4 legado → SNAP_BAR). */
export function snapSelectValue(snapEnabled: boolean, snapValor: number): number {
  if (!snapEnabled || !(snapValor > 0 || snapValor === SNAP_BAR)) return 0
  if (snapValor === 4) return SNAP_BAR
  return snapValor
}

/**
 * Ancla un beat al límite seleccionado en el toolbar.
 * - playheadSnap OFF o snapValor 0 → sin anclar
 * - si no, redondea exactamente a esa división (no a subdivisiones más finas)
 */
export function snapSeekBeat(beat: number, opts: SeekSnapOpts): number {
  const playheadSnap = opts.playheadSnap !== false
  const snapEnabled = opts.snapEnabled !== false
  const division = resolveSnapDivision(opts.snapValor ?? 0, opts.beatsPerBar ?? 4)
  if (!playheadSnap || !snapEnabled || !(division > 0)) {
    return Math.max(0, beat)
  }
  const snapped = snapBeatToDivision(Math.max(0, beat), division, true)
  const decimals = division >= 1 ? 4 : division >= 0.25 ? 6 : 8
  return Number(snapped.toFixed(decimals))
}

export function labelForSnapValor(valor: number): string {
  const hit = TIMELINE_SNAP_OPTIONS.find((o) => o.value === valor)
  if (hit) return hit.label
  // Proyectos antiguos con 4 beats ≈ 1 compás en 4/4
  if (valor === 4) return '1 Compás (1 Bar)'
  return `${valor} beats`
}

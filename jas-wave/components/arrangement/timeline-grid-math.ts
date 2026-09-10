/**
 * Matemática compartida regla ↔ rejilla (mismas X, mismo intervalo de compases).
 */

import { adaptiveGridForZoom, snapBeatToDivision } from '../../../shared/src/midi/grid'

/** Cada cuántos compases dibujar marca mayor / etiqueta (evita overcrowding). */
export function majorBarInterval(pxPerBar: number, minSpacingPx = 36): number {
  if (!(pxPerBar > 0) || !Number.isFinite(pxPerBar)) return 1
  if (pxPerBar >= minSpacingPx) return 1
  return Math.max(1, Math.ceil(minSpacingPx / pxPerBar))
}

/** X en viewport sticky: beat → pixel (contenido) menos scroll. */
export function beatToViewX(beat: number, pixelsPerBeat: number, scrollX: number): number {
  return beat * pixelsPerBeat - scrollX
}

/** Alineación crisp de 1px en canvas. */
export function crispX(viewX: number): number {
  return Math.round(viewX) + 0.5
}

/** División más fina dibujada a este zoom (misma fuente que la rejilla). */
export function finestGridDivision(pixelsPerBeat: number, beatsPerBar: number): number {
  const lines = adaptiveGridForZoom(pixelsPerBeat, beatsPerBar)
  return lines[lines.length - 1]?.spacingBeats ?? Math.max(1, beatsPerBar)
}

/**
 * División de anclaje del playhead.
 * - Precisión ON → línea más fina visible a este zoom (no el snapValor de clips).
 * - Precisión OFF → sin anclaje (seek libre).
 */
export function playheadSnapDivision(
  pixelsPerBeat: number,
  beatsPerBar: number,
  playheadSnapEnabled: boolean,
): number {
  if (!playheadSnapEnabled) return 0
  return finestGridDivision(pixelsPerBeat, beatsPerBar)
}

/** Ancla un beat a la división del playhead. */
export function snapPlayheadBeat(
  beat: number,
  pixelsPerBeat: number,
  beatsPerBar: number,
  playheadSnapEnabled: boolean,
): number {
  const div = playheadSnapDivision(pixelsPerBeat, beatsPerBar, playheadSnapEnabled)
  if (!(div > 0)) return Math.max(0, beat)
  const snapped = snapBeatToDivision(Math.max(0, beat), div, true)
  const decimals = div >= 1 ? 4 : div >= 0.25 ? 6 : 8
  return Number(snapped.toFixed(decimals))
}

/** Etiqueta musical compacta: 102 | 102.2 | 102.1.3 */
export function formatPlayheadLabel(beat: number, beatsPerBar: number, division: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const beatInBar = beat % beatsPerBar
  const beatIdx = Math.floor(beatInBar) + 1
  if (!(division > 0) || division >= 1) {
    if (division >= beatsPerBar) return String(bar)
    const frac = beatInBar - Math.floor(beatInBar)
    if (frac < 1e-6) return `${bar}.${beatIdx}`
    return `${bar}.${Number((beatInBar + 1).toFixed(3))}`
  }
  const sub = Math.round(beatInBar / division)
  const beatNum = Math.floor(sub * division) + 1
  const subIdx = Math.round((beatInBar % 1) / division)
  if (subIdx <= 0) return `${bar}.${beatNum}`
  return `${bar}.${beatNum}.${subIdx}`
}

/**
 * Matemática compartida regla ↔ rejilla (mismas X, mismo intervalo de compases).
 *
 * Visual: exactamente 3 niveles — primary, primary/2, primary/4.
 * Encaje S (toolbar): al acercar al máximo el trío es S · S/2 · S/4
 * (p. ej. 1/2 → 1/2, 1/4, 1/8). Nunca más fino que S/4.
 * Al alejar: primary = 2, 4, 8, 16… con umbrales amplios.
 */

import { type GridLineKind, type GridLineSpec } from '../../../shared/src/midi/grid'
import { snapSeekBeat } from '@/src/lib/timeline-snap'

/**
 * Márgenes amplios: hace falta mucho zoom antes de cambiar de trío.
 * (antes ~7/52/140 — cambiaba demasiado pronto)
 */
const MIN_FINEST_PX = 22
const TARGET_PRIMARY_PX = 110
const MAX_PRIMARY_PX = 340

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

function kindForSpacing(spacingBeats: number, beatsPerBar: number): GridLineKind {
  if (spacingBeats >= beatsPerBar - 1e-9) return 'bar'
  if (spacingBeats >= 1 - 1e-9) return 'beat'
  if (spacingBeats >= 0.25 - 1e-9) return 'subdivision'
  return 'micro'
}

function uniqSorted(values: number[]): number[] {
  const out: number[] = []
  for (const v of values) {
    if (!(v > 0) || !Number.isFinite(v)) continue
    const r = Number(v.toPrecision(12))
    if (out.length === 0 || Math.abs(out[out.length - 1]! - r) > 1e-12) out.push(r)
  }
  return out.sort((a, b) => a - b)
}

/**
 * Escalones musicales: …16·compás, 8·compás, …, compás, …, 1, 1/2, 1/4, … 1/128.
 */
export function musicalGridSteps(beatsPerBar = 4): number[] {
  const bar = Math.max(1, beatsPerBar)
  const steps: number[] = []
  for (let n = 64; n >= 1; n /= 2) {
    steps.push(n * bar)
  }
  let s = bar / 2
  while (s >= 1 / 128 - 1e-12) {
    steps.push(s)
    s /= 2
  }
  return uniqSorted(steps)
}

/**
 * Nivel primario según zoom (+ tope de profundidad del selector de encaje).
 * Con snap = S, al máximo zoom el trío es S, S/2, S/4 (nunca más fino que S/4).
 * @param maxDepthBeats valor de encaje resuelto (S). 0 = sin tope.
 */
export function pickZoomGridPrimary(
  pixelsPerBeat: number,
  beatsPerBar = 4,
  maxDepthBeats = 0,
): number {
  const steps = musicalGridSteps(beatsPerBar)
  const fallback = Math.max(1, beatsPerBar)
  if (!(pixelsPerBeat > 0) || steps.length === 0) return fallback

  // No permitir que primary/4 quede más denso que MIN_FINEST_PX
  const minPrimaryByZoom = (MIN_FINEST_PX * 4) / pixelsPerBeat
  // Snap S → primario mínimo = S (trío S, S/2, S/4)
  const minPrimaryBySnap = maxDepthBeats > 0 ? maxDepthBeats : 0
  const minPrimary = Math.max(minPrimaryByZoom, minPrimaryBySnap)

  let allowed = steps.filter((s) => s >= minPrimary - 1e-12)
  if (allowed.length === 0) {
    const bySnap =
      maxDepthBeats > 0 ? steps.filter((s) => s >= maxDepthBeats - 1e-12) : []
    allowed = bySnap.length > 0 ? bySnap : [steps[steps.length - 1]!]
  }

  const ideal = TARGET_PRIMARY_PX / pixelsPerBeat
  let best = allowed[0]!
  let bestScore = Infinity
  for (const s of allowed) {
    const primaryPx = s * pixelsPerBeat
    const widePenalty =
      primaryPx > MAX_PRIMARY_PX ? Math.pow(primaryPx / MAX_PRIMARY_PX, 1.5) : 0
    const score = Math.abs(Math.log(s / Math.max(ideal, 1e-9))) + widePenalty
    if (score < bestScore) {
      bestScore = score
      best = s
    }
  }

  // No más fino que el trío anclado al encaje: S, S/2, S/4
  if (maxDepthBeats > 0 && best < maxDepthBeats - 1e-12) {
    const hit = steps.find((s) => s >= maxDepthBeats - 1e-12)
    best = hit ?? maxDepthBeats
  }
  return best
}

/**
 * Exactamente 3 niveles: primary, primary/2, primary/4.
 * Con encaje S y zoom al máximo: S, S/2, S/4.
 */
export function gridLevelsForZoom(
  pixelsPerBeat: number,
  beatsPerBar = 4,
  maxDepthBeats = 0,
): GridLineSpec[] {
  const primary = pickZoomGridPrimary(pixelsPerBeat, beatsPerBar, maxDepthBeats)
  const bar = Math.max(1, beatsPerBar)
  return [primary / 4, primary / 2, primary].map((spacingBeats) => ({
    kind: kindForSpacing(spacingBeats, bar),
    spacingBeats,
  }))
}

/** Compat: mismo comportamiento con tope de profundidad. */
export function gridLevelsForSnap(
  pixelsPerBeat: number,
  beatsPerBar: number,
  maxDivisionBeats = 0,
): GridLineSpec[] {
  return gridLevelsForZoom(pixelsPerBeat, beatsPerBar, maxDivisionBeats)
}

/** 0 = primario (más grueso), 1 = mitad, 2 = cuarto. */
export function zoomLevelRank(
  spacingBeats: number,
  primaryBeats: number,
): 0 | 1 | 2 | -1 {
  if (!(primaryBeats > 0)) return -1
  if (Math.abs(spacingBeats - primaryBeats) < 1e-9) return 0
  if (Math.abs(spacingBeats - primaryBeats / 2) < 1e-9) return 1
  if (Math.abs(spacingBeats - primaryBeats / 4) < 1e-9) return 2
  return -1
}

export function snapLevelRank(
  spacingBeats: number,
  primaryOrSnap: number,
): -1 | 0 | 1 | 2 {
  return zoomLevelRank(spacingBeats, primaryOrSnap)
}

export function finestGridDivision(
  pixelsPerBeat: number,
  beatsPerBar: number,
  maxDepthBeats = 0,
): number {
  const primary = pickZoomGridPrimary(pixelsPerBeat, beatsPerBar, maxDepthBeats)
  return primary / 4
}

/** Etiqueta compacta para un beat en la regla. */
export function formatRulerLabel(beat: number, beatsPerBar: number, step: number): string {
  const bar = Math.floor(beat / beatsPerBar) + 1
  if (step >= beatsPerBar - 1e-9) return String(bar)
  const beatInBar = beat % beatsPerBar
  const beatIdx = Math.floor(beatInBar) + 1
  if (step >= 1 - 1e-9) {
    if (Math.abs(beatInBar) < 1e-6) return String(bar)
    return `${bar}.${beatIdx}`
  }
  const sub = Math.round((beatInBar % 1) / step)
  if (sub <= 0) return `${bar}.${beatIdx}`
  return `${bar}.${beatIdx}.${sub}`
}

export function snapPlayheadBeat(
  beat: number,
  opts: {
    playheadSnap: boolean
    snapEnabled: boolean
    snapValor: number
    beatsPerBar?: number
  },
): number {
  return snapSeekBeat(beat, opts)
}

export function formatPlayheadLabel(beat: number, beatsPerBar: number, division: number): string {
  return formatRulerLabel(beat, beatsPerBar, division > 0 ? division : beatsPerBar)
}

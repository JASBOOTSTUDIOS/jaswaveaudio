/**
 * Constantes / helpers de viewport temporal compartidos (arrange + piano roll).
 */

/** Factor de zoom por “tick” de rueda (mismo que ArrangementView). */
export const TIMELINE_ZOOM_FACTOR = 1.15

/** Límites de px/beat en el piano roll (estado local). */
export const PIANO_PX_PER_BEAT_MIN = 12
export const PIANO_PX_PER_BEAT_MAX = 256

/** Tras zoom anclado a un beat: nuevo scrollLeft para mantener el beat en viewX. */
export function scrollLeftKeepingBeat(
  beat: number,
  newPxPerBeat: number,
  viewX: number,
): number {
  return Math.max(0, beat * newPxPerBeat - viewX)
}

/** Zoom horizontal anclado a un beat (playhead). */
export function nextPxPerBeat(
  prev: number,
  zoomIn: boolean,
  factor = TIMELINE_ZOOM_FACTOR,
  min = PIANO_PX_PER_BEAT_MIN,
  max = PIANO_PX_PER_BEAT_MAX,
): number {
  const next = zoomIn ? prev * factor : prev / factor
  return Math.min(max, Math.max(min, next))
}

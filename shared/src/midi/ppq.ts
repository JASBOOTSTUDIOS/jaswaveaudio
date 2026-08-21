/**
 * Constantes y conversiones PPQ (ticks musicales).
 *
 * El dominio usa ticks como representación precisa.
 * Los clips legacy almacenan inicio/duración en beats; estos helpers unifican.
 */

/** Ticks por quarter note (beat) — resolución interna JasWave. */
export const MIDI_PPQ = 960 as const;

export type SubdivisionId =
  | '1/1'
  | '1/2'
  | '1/4'
  | '1/8'
  | '1/16'
  | '1/32'
  | '1/64'
  | '1/128'
  | '1/8t'
  | '1/16t'
  | '1/4t'
  | '1/8q'
  | '1/16q'
  | '1/8s'
  | 'custom';

/** Fracción de beat para cada subdivisión (1 = un beat / negra). */
export const SUBDIVISION_BEATS: Record<Exclude<SubdivisionId, 'custom'>, number> = {
  '1/1': 4,
  '1/2': 2,
  '1/4': 1,
  '1/8': 0.5,
  '1/16': 0.25,
  '1/32': 0.125,
  '1/64': 0.0625,
  '1/128': 0.03125,
  '1/8t': 1 / 3,
  '1/16t': 1 / 6,
  '1/4t': 2 / 3,
  '1/8q': 0.4,
  '1/16q': 0.2,
  '1/8s': 0.5, // swing se aplica aparte
};

export function beatsToTicks(beats: number, ppq: number = MIDI_PPQ): number {
  return Math.round(beats * ppq);
}

export function ticksToBeats(ticks: number, ppq: number = MIDI_PPQ): number {
  return ticks / ppq;
}

export function subdivisionToTicks(
  subdivision: Exclude<SubdivisionId, 'custom'>,
  ppq: number = MIDI_PPQ,
): number {
  return beatsToTicks(SUBDIVISION_BEATS[subdivision], ppq);
}

/** Cuantiza un valor en ticks hacia la rejilla con fuerza 0..1. */
export function quantizeTicks(
  ticks: number,
  gridTicks: number,
  strength = 1,
): number {
  if (gridTicks <= 0) return ticks;
  const target = Math.round(ticks / gridTicks) * gridTicks;
  const s = Math.max(0, Math.min(1, strength));
  return Math.round(ticks + (target - ticks) * s);
}

export function quantizeBeats(
  beats: number,
  gridBeats: number,
  strength = 1,
  ppq: number = MIDI_PPQ,
): number {
  const t = beatsToTicks(beats, ppq);
  const g = beatsToTicks(gridBeats, ppq);
  return ticksToBeats(quantizeTicks(t, g, strength), ppq);
}

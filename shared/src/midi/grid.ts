/**
 * Grid adaptativo: qué subdivisiones mostrar según zoom (px por beat).
 * Solo presentación — el snap usa otra API.
 */

import { SUBDIVISION_BEATS, type SubdivisionId } from './ppq';

export type GridLineKind = 'bar' | 'beat' | 'subdivision' | 'micro';

export interface GridLineSpec {
  kind: GridLineKind;
  /** Espaciado en beats */
  spacingBeats: number;
  subdivision?: SubdivisionId;
}

/**
 * Dado px/beat (zoom horizontal), elige líneas principales/secundarias
 * sin saturar la vista.
 */
export function adaptiveGridForZoom(pixelsPerBeat: number): GridLineSpec[] {
  const lines: GridLineSpec[] = [];

  // Siempre compás (4/4 por defecto en UI; el caller puede filtrar)
  lines.push({ kind: 'bar', spacingBeats: 4 });

  if (pixelsPerBeat >= 8) {
    lines.push({ kind: 'beat', spacingBeats: 1 });
  }
  if (pixelsPerBeat >= 24) {
    lines.push({ kind: 'subdivision', spacingBeats: 0.5, subdivision: '1/8' });
  }
  if (pixelsPerBeat >= 48) {
    lines.push({ kind: 'subdivision', spacingBeats: 0.25, subdivision: '1/16' });
  }
  if (pixelsPerBeat >= 96) {
    lines.push({ kind: 'micro', spacingBeats: 0.125, subdivision: '1/32' });
  }
  if (pixelsPerBeat >= 192) {
    lines.push({ kind: 'micro', spacingBeats: SUBDIVISION_BEATS['1/64'], subdivision: '1/64' });
  }
  if (pixelsPerBeat >= 384) {
    lines.push({ kind: 'micro', spacingBeats: SUBDIVISION_BEATS['1/128'], subdivision: '1/128' });
  }

  return lines;
}

export type SnapMode =
  | 'off'
  | 'grid'
  | 'notes'
  | 'events'
  | 'bar'
  | 'beat'
  | 'division';

export interface SnapConfig {
  mode: SnapMode;
  /** División cuando mode === 'grid' | 'division' */
  divisionBeats: number;
  strength: number;
}

/** Redondea un beat a la división musical (0 = off). */
export function snapBeatToDivision(beat: number, divisionBeats: number, enabled = true): number {
  if (!enabled || !(divisionBeats > 0) || !Number.isFinite(beat)) return beat;
  return Math.round(beat / divisionBeats) * divisionBeats;
}

/** Duración mínima al menos una división. */
export function snapDurationToDivision(
  durationBeats: number,
  divisionBeats: number,
  enabled = true,
): number {
  if (!enabled || !(divisionBeats > 0)) return Math.max(0, durationBeats);
  return Math.max(divisionBeats, Math.round(durationBeats / divisionBeats) * divisionBeats);
}

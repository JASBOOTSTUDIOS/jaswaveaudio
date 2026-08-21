/**
 * Posición musical explícita: bar / beat / tick.
 */

import { MIDI_PPQ, beatsToTicks, ticksToBeats } from './ppq';

export interface MusicalPosition {
  /** Compás 1-based */
  bar: number;
  /** Beat dentro del compás, 1-based */
  beat: number;
  /** Tick dentro del beat [0, ppq) */
  tick: number;
}

export interface TimeSignatureLike {
  numerador: number;
  denominador: number;
}

export function beatsToMusical(
  absoluteBeats: number,
  ts: TimeSignatureLike = { numerador: 4, denominador: 4 },
  ppq: number = MIDI_PPQ,
): MusicalPosition {
  const beatsPerBar = ts.numerador;
  const safe = Math.max(0, absoluteBeats);
  const barIndex = Math.floor(safe / beatsPerBar);
  const beatInBar = safe - barIndex * beatsPerBar;
  const beatFloor = Math.floor(beatInBar);
  const frac = beatInBar - beatFloor;
  return {
    bar: barIndex + 1,
    beat: beatFloor + 1,
    tick: beatsToTicks(frac, ppq),
  };
}

export function musicalToBeats(
  pos: MusicalPosition,
  ts: TimeSignatureLike = { numerador: 4, denominador: 4 },
  ppq: number = MIDI_PPQ,
): number {
  const beatsPerBar = ts.numerador;
  const barBeats = (Math.max(1, pos.bar) - 1) * beatsPerBar;
  const beatBeats = Math.max(1, pos.beat) - 1;
  return barBeats + beatBeats + ticksToBeats(Math.max(0, pos.tick), ppq);
}

export function formatMusical(pos: MusicalPosition): string {
  return `${pos.bar}:${pos.beat}:${pos.tick}`;
}

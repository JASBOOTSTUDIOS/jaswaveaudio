/**
 * Escalas musicales para constraints y generación IA.
 */

export type ScaleType =
  | 'major'
  | 'minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'pentatonic_major'
  | 'pentatonic_minor'
  | 'blues';

const INTERVALS: Record<ScaleType, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  pentatonic_major: [0, 2, 4, 7, 9],
  pentatonic_minor: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function parseRoot(root: string): number {
  const n = root.trim().toUpperCase().replace('H', 'B');
  const flat = n.replace('B', '#').replace(/DB/, 'C#').replace(/EB/, 'D#').replace(/GB/, 'F#').replace(/AB/, 'G#');
  // handle flats: Db -> C#
  const map: Record<string, number> = {
    C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4, F: 5, 'F#': 6, GB: 6,
    G: 7, 'G#': 8, AB: 8, A: 9, 'A#': 10, BB: 10, B: 11,
  };
  const key = n.replace('♭', 'B').replace('♯', '#');
  if (key in map) return map[key];
  if (flat in map) return map[flat];
  const idx = NOTE_NAMES.indexOf(n);
  return idx >= 0 ? idx : 0;
}

export function pitchInScale(pitch: number, rootPc: number, scale: ScaleType): boolean {
  const pc = ((pitch % 12) + 12) % 12;
  const rel = (pc - rootPc + 12) % 12;
  return INTERVALS[scale].includes(rel);
}

export function snapPitchToScale(pitch: number, rootPc: number, scale: ScaleType): number {
  if (pitchInScale(pitch, rootPc, scale)) return pitch;
  for (let d = 1; d <= 6; d++) {
    if (pitchInScale(pitch + d, rootPc, scale)) return Math.min(127, pitch + d);
    if (pitchInScale(pitch - d, rootPc, scale)) return Math.max(0, pitch - d);
  }
  return pitch;
}

export function scalePitches(rootPc: number, scale: ScaleType, from = 36, to = 84): number[] {
  const out: number[] = [];
  for (let p = from; p <= to; p++) {
    if (pitchInScale(p, rootPc, scale)) out.push(p);
  }
  return out;
}

export function constrainNotesToScale<T extends { pitch: number }>(
  notes: T[],
  root: string | number,
  scale: ScaleType,
): T[] {
  const rootPc = typeof root === 'number' ? root % 12 : parseRoot(root);
  return notes.map((n) => ({ ...n, pitch: snapPitchToScale(n.pitch, rootPc, scale) }));
}

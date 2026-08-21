/**
 * Groove templates — offsets de timing/velocity deterministas.
 */

import type { MidiNote } from '../types/clips';
import { createSeededRandom } from './note-ops';

export interface GrooveStep {
  /** Offset de timing en beats (puede ser negativo). */
  timing: number;
  /** Offset de velocity (-127..127). */
  velocity: number;
}

export interface GrooveTemplate {
  id: string;
  nombre: string;
  /** Subdivision del groove en beats (p.ej. 0.25 = 16ths). */
  stepBeats: number;
  steps: GrooveStep[];
  swing?: number;
}

export const GROOVE_LIBRARY: GrooveTemplate[] = [
  {
    id: 'straight-16',
    nombre: 'Recto (semicorcheas)',
    stepBeats: 0.25,
    steps: Array.from({ length: 16 }, () => ({ timing: 0, velocity: 0 })),
  },
  {
    id: 'swing-8',
    nombre: 'Swing (corcheas)',
    stepBeats: 0.5,
    swing: 0.66,
    steps: [
      { timing: 0, velocity: 4 },
      { timing: 0.08, velocity: -6 },
      { timing: 0, velocity: 2 },
      { timing: 0.1, velocity: -8 },
      { timing: 0, velocity: 4 },
      { timing: 0.08, velocity: -4 },
      { timing: 0, velocity: 0 },
      { timing: 0.12, velocity: -10 },
    ],
  },
  {
    id: 'mpc-60',
    nombre: 'Estilo MPC',
    stepBeats: 0.25,
    steps: [
      { timing: 0.01, velocity: 8 },
      { timing: -0.01, velocity: -12 },
      { timing: 0.015, velocity: 4 },
      { timing: -0.008, velocity: -6 },
      { timing: 0.012, velocity: 10 },
      { timing: -0.012, velocity: -14 },
      { timing: 0.008, velocity: 2 },
      { timing: -0.005, velocity: -8 },
      { timing: 0.01, velocity: 6 },
      { timing: -0.01, velocity: -10 },
      { timing: 0.014, velocity: 4 },
      { timing: -0.006, velocity: -5 },
      { timing: 0.011, velocity: 8 },
      { timing: -0.009, velocity: -12 },
      { timing: 0.007, velocity: 0 },
      { timing: -0.004, velocity: -7 },
    ],
  },
  {
    id: 'motown-push',
    nombre: 'Adelantado (push)',
    stepBeats: 0.5,
    steps: [
      { timing: -0.02, velocity: 6 },
      { timing: -0.015, velocity: -4 },
      { timing: -0.025, velocity: 8 },
      { timing: -0.01, velocity: -2 },
    ],
  },
];

export function getGroove(id: string): GrooveTemplate | undefined {
  return GROOVE_LIBRARY.find((g) => g.id === id);
}

export function applyGroove(
  notes: MidiNote[],
  grooveId: string,
  opts: { strength?: number; seed?: number; noteIds?: string[] } = {},
): MidiNote[] {
  const groove = getGroove(grooveId);
  if (!groove || groove.steps.length === 0) return notes;
  const strength = Math.max(0, Math.min(1, opts.strength ?? 1));
  const set = opts.noteIds?.length ? new Set(opts.noteIds) : null;
  const rand = createSeededRandom(opts.seed ?? 1);

  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    const idx =
      Math.floor(Math.max(0, n.inicio) / groove.stepBeats) % groove.steps.length;
    const step = groove.steps[idx]!;
    const jitter = opts.seed !== undefined ? (rand() - 0.5) * 0.004 * strength : 0;
    return {
      ...n,
      inicio: Math.max(0, n.inicio + (step.timing + jitter) * strength),
      velocidad: Math.max(
        1,
        Math.min(127, Math.round(n.velocidad + step.velocity * strength)),
      ),
      source: n.source ?? 'humanized',
      metadata: { ...(n.metadata ?? {}), grooveId, grooveStrength: strength },
    };
  });
}

export function extractGrooveFromNotes(notes: MidiNote[], stepBeats = 0.25): GrooveTemplate {
  const steps: GrooveStep[] = [];
  const buckets = new Map<number, { t: number[]; v: number[] }>();
  for (const n of notes) {
    const idx = Math.floor(n.inicio / stepBeats);
    const ideal = idx * stepBeats;
    const b = buckets.get(idx % 16) ?? { t: [], v: [] };
    b.t.push(n.inicio - ideal);
    b.v.push(n.velocidad);
    buckets.set(idx % 16, b);
  }
  const meanVel =
    notes.length > 0 ? notes.reduce((s, n) => s + n.velocidad, 0) / notes.length : 80;
  for (let i = 0; i < 16; i++) {
    const b = buckets.get(i);
    if (!b || b.t.length === 0) {
      steps.push({ timing: 0, velocity: 0 });
      continue;
    }
    const timing = b.t.reduce((s, x) => s + x, 0) / b.t.length;
    const velocity = b.v.reduce((s, x) => s + x, 0) / b.v.length - meanVel;
    steps.push({ timing, velocity: Math.round(velocity) });
  }
  return {
    id: `extracted-${Date.now().toString(36)}`,
    nombre: 'Extracted groove',
    stepBeats,
    steps,
  };
}

/**
 * Operaciones puras sobre notas MIDI (deterministas, sin I/O).
 * Usadas por comandos y por la IA — nunca mutan el estado directamente.
 */

import { quantizeBeats } from './ppq';
import type { MidiNote } from '../types/clips';

/** PRNG mulberry32 — reproducible con seed. */
export function createSeededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function transposeNotes(
  notes: MidiNote[],
  semitones: number,
  noteIds?: string[],
): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    return {
      ...n,
      pitch: Math.max(0, Math.min(127, n.pitch + semitones)),
    };
  });
}

export type QuantizeMode = 'start' | 'end' | 'both';

export function quantizeNotes(
  notes: MidiNote[],
  opts: {
    gridBeats: number;
    strength?: number;
    mode?: QuantizeMode;
    noteIds?: string[];
  },
): MidiNote[] {
  const strength = opts.strength ?? 1;
  const mode = opts.mode ?? 'start';
  const set = opts.noteIds?.length ? new Set(opts.noteIds) : null;
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    let inicio = n.inicio;
    let duracion = n.duracion;
    if (mode === 'start' || mode === 'both') {
      inicio = Math.max(0, quantizeBeats(n.inicio, opts.gridBeats, strength));
    }
    if (mode === 'end' || mode === 'both') {
      const end = quantizeBeats(n.inicio + n.duracion, opts.gridBeats, strength);
      duracion = Math.max(opts.gridBeats / 4, end - inicio);
    }
    return { ...n, inicio, duracion };
  });
}

export function humanizeNotes(
  notes: MidiNote[],
  opts: {
    timingAmount?: number;
    velocityAmount?: number;
    durationAmount?: number;
    seed: number;
    noteIds?: string[];
  },
): MidiNote[] {
  const rand = createSeededRandom(opts.seed);
  const timing = opts.timingAmount ?? 0;
  const velAmt = opts.velocityAmount ?? 0;
  const durAmt = opts.durationAmount ?? 0;
  const set = opts.noteIds?.length ? new Set(opts.noteIds) : null;

  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    const tOff = timing > 0 ? (rand() * 2 - 1) * timing : 0;
    const vOff = velAmt > 0 ? Math.round((rand() * 2 - 1) * velAmt) : 0;
    const dOff = durAmt > 0 ? (rand() * 2 - 1) * durAmt : 0;
    return {
      ...n,
      inicio: Math.max(0, n.inicio + tOff),
      duracion: Math.max(0.03125, n.duracion + dOff),
      velocidad: Math.max(1, Math.min(127, n.velocidad + vOff)),
      source: n.source ?? 'humanized',
      metadata: {
        ...(n.metadata ?? {}),
        humanizeSeed: opts.seed,
      },
    };
  });
}

export function scaleVelocityRelative(
  notes: MidiNote[],
  factor: number,
  noteIds?: string[],
): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const targets = set ? notes.filter((n) => set.has(n.id)) : notes;
  if (targets.length === 0) return notes;
  const mean = targets.reduce((s, n) => s + n.velocidad, 0) / targets.length;
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    const delta = n.velocidad - mean;
    const next = Math.round(mean + delta * factor);
    return { ...n, velocidad: Math.max(1, Math.min(127, next)) };
  });
}

export function setVelocityAbsolute(
  notes: MidiNote[],
  velocity: number,
  noteIds?: string[],
): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const v = Math.max(1, Math.min(127, Math.round(velocity)));
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    return { ...n, velocidad: v };
  });
}

export function makeStaccato(
  notes: MidiNote[],
  ratio = 0.5,
  noteIds?: string[],
): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const r = Math.max(0.05, Math.min(1, ratio));
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    return {
      ...n,
      duracion: Math.max(0.03125, n.duracion * r),
      articulation: n.articulation ?? 'staccato',
    };
  });
}

export function makeLegato(
  notes: MidiNote[],
  noteIds?: string[],
  gapBeats = 0,
): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const sorted = [...notes].sort((a, b) => a.inicio - b.inicio || a.pitch - b.pitch);
  const byPitch = new Map<number, MidiNote[]>();
  for (const n of sorted) {
    if (set && !set.has(n.id)) continue;
    const list = byPitch.get(n.pitch) ?? [];
    list.push(n);
    byPitch.set(n.pitch, list);
  }
  const overrides = new Map<string, number>();
  for (const list of byPitch.values()) {
    for (let i = 0; i < list.length - 1; i++) {
      const cur = list[i];
      const next = list[i + 1];
      const end = Math.max(0.03125, next.inicio - gapBeats - cur.inicio);
      overrides.set(cur.id, end);
    }
  }
  return notes.map((n) => {
    const d = overrides.get(n.id);
    if (d === undefined) return n;
    return { ...n, duracion: d, articulation: n.articulation ?? 'legato' };
  });
}

export function deleteNotesById(notes: MidiNote[], noteIds: string[]): MidiNote[] {
  const set = new Set(noteIds);
  return notes.filter((n) => !set.has(n.id));
}

export function appendNotes(notes: MidiNote[], extra: MidiNote[]): MidiNote[] {
  return [...notes, ...extra];
}

export function repeatSelection(
  notes: MidiNote[],
  noteIds: string[],
  times: number,
  gapBeats = 0,
): MidiNote[] {
  const set = new Set(noteIds);
  const sel = notes.filter((n) => set.has(n.id));
  if (sel.length === 0 || times < 1) return notes;
  const start = Math.min(...sel.map((n) => n.inicio));
  const end = Math.max(...sel.map((n) => n.inicio + n.duracion));
  const span = end - start + gapBeats;
  const out = [...notes];
  for (let t = 1; t <= times; t++) {
    for (const n of sel) {
      out.push({
        ...n,
        id: `${n.id}-rep-${t}-${Math.random().toString(36).slice(2, 6)}`,
        inicio: n.inicio + span * t,
        seleccionada: false,
      });
    }
  }
  return out;
}

export function reverseInTime(notes: MidiNote[], noteIds?: string[]): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const targets = set ? notes.filter((n) => set.has(n.id)) : notes;
  if (targets.length === 0) return notes;
  const minS = Math.min(...targets.map((n) => n.inicio));
  const maxE = Math.max(...targets.map((n) => n.inicio + n.duracion));
  const map = new Map<string, MidiNote>();
  for (const n of targets) {
    const end = n.inicio + n.duracion;
    map.set(n.id, { ...n, inicio: minS + (maxE - end) });
  }
  return notes.map((n) => map.get(n.id) ?? n);
}

export function invertPitches(notes: MidiNote[], noteIds?: string[], axis?: number): MidiNote[] {
  const set = noteIds?.length ? new Set(noteIds) : null;
  const targets = set ? notes.filter((n) => set.has(n.id)) : notes;
  if (targets.length === 0) return notes;
  const ax =
    axis ??
    Math.round(targets.reduce((s, n) => s + n.pitch, 0) / targets.length);
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    return { ...n, pitch: Math.max(0, Math.min(127, ax * 2 - n.pitch)) };
  });
}

export function timeStretchNotes(
  notes: MidiNote[],
  factor: number,
  noteIds?: string[],
): MidiNote[] {
  const f = Math.max(0.25, Math.min(4, factor));
  const set = noteIds?.length ? new Set(noteIds) : null;
  const targets = set ? notes.filter((n) => set.has(n.id)) : notes;
  if (targets.length === 0) return notes;
  const origin = Math.min(...targets.map((n) => n.inicio));
  return notes.map((n) => {
    if (set && !set.has(n.id)) return n;
    return {
      ...n,
      inicio: origin + (n.inicio - origin) * f,
      duracion: Math.max(0.03125, n.duracion * f),
    };
  });
}

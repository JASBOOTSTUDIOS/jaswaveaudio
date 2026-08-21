/**
 * MIDI Query API — lectura estructurada para UI e IA.
 * Nunca muta estado.
 */

import type { DAWState } from '../types/state';
import type { MidiClip, MidiNote } from '../types/clips';
import { beatsToMusical } from './musical-time';

export interface MidiClipRef {
  trackId: string;
  clipId: string;
  clip: MidiClip;
}

export interface MidiNoteQuery {
  clipId: string;
  trackId?: string;
  start?: number;
  end?: number;
  pitchMin?: number;
  pitchMax?: number;
  noteIds?: string[];
  selectedOnly?: boolean;
  channel?: number;
  limit?: number;
}

export interface MidiClipSummary {
  clipId: string;
  trackId: string;
  nombre: string;
  inicio: number;
  duracion: number;
  noteCount: number;
  pitchMin: number | null;
  pitchMax: number | null;
  velocityMin: number | null;
  velocityMax: number | null;
  channels: number[];
  densityPerBeat: number;
  rangeMusical: { start: string; end: string };
}

export function findMidiClip(state: DAWState, clipId: string, trackId?: string): MidiClipRef | null {
  const tracks = state.project?.tracks ?? [];
  for (const t of tracks) {
    if (trackId && t.id !== trackId) continue;
    const clip = (t.clips ?? []).find((c) => c.id === clipId);
    if (clip && (clip as MidiClip).tipo === 'midi') {
      return { trackId: t.id, clipId: clip.id, clip: clip as MidiClip };
    }
  }
  return null;
}

export function getNotes(state: DAWState, q: MidiNoteQuery): MidiNote[] {
  const ref = findMidiClip(state, q.clipId, q.trackId);
  if (!ref) return [];
  let notes = ref.clip.notas ?? [];
  if (q.noteIds?.length) {
    const set = new Set(q.noteIds);
    notes = notes.filter((n) => set.has(n.id));
  }
  if (q.selectedOnly) notes = notes.filter((n) => n.seleccionada);
  if (q.start !== undefined) notes = notes.filter((n) => n.inicio + n.duracion >= q.start!);
  if (q.end !== undefined) notes = notes.filter((n) => n.inicio <= q.end!);
  if (q.pitchMin !== undefined) notes = notes.filter((n) => n.pitch >= q.pitchMin!);
  if (q.pitchMax !== undefined) notes = notes.filter((n) => n.pitch <= q.pitchMax!);
  if (q.channel !== undefined) notes = notes.filter((n) => n.canal === q.channel);
  if (q.limit !== undefined) notes = notes.slice(0, q.limit);
  return notes;
}

export function getClipSummary(state: DAWState, clipId: string, trackId?: string): MidiClipSummary | null {
  const ref = findMidiClip(state, clipId, trackId);
  if (!ref) return null;
  const notes = ref.clip.notas ?? [];
  const channels = [...new Set(notes.map((n) => n.canal))].sort((a, b) => a - b);
  const pitches = notes.map((n) => n.pitch);
  const vels = notes.map((n) => n.velocidad);
  const dur = Math.max(ref.clip.duracion, 0.0001);
  const ts = {
    numerador: state.project?.timeSignature?.numerador ?? 4,
    denominador: state.project?.timeSignature?.denominador ?? 4,
  };
  return {
    clipId: ref.clipId,
    trackId: ref.trackId,
    nombre: ref.clip.nombre,
    inicio: ref.clip.inicio,
    duracion: ref.clip.duracion,
    noteCount: notes.length,
    pitchMin: pitches.length ? Math.min(...pitches) : null,
    pitchMax: pitches.length ? Math.max(...pitches) : null,
    velocityMin: vels.length ? Math.min(...vels) : null,
    velocityMax: vels.length ? Math.max(...vels) : null,
    channels,
    densityPerBeat: notes.length / dur,
    rangeMusical: {
      start: `${beatsToMusical(ref.clip.inicio, ts).bar}:${beatsToMusical(ref.clip.inicio, ts).beat}`,
      end: `${beatsToMusical(ref.clip.inicio + ref.clip.duracion, ts).bar}:${beatsToMusical(ref.clip.inicio + ref.clip.duracion, ts).beat}`,
    },
  };
}

export function musicalSummaryText(state: DAWState, clipId: string, trackId?: string): string {
  const s = getClipSummary(state, clipId, trackId);
  if (!s) return 'Clip MIDI no encontrado';
  const bpm = state.project?.bpm?.valor ?? 120;
  const ts = state.project?.timeSignature;
  return [
    `Tempo: ${bpm}`,
    `Time Signature: ${ts?.numerador ?? 4}/${ts?.denominador ?? 4}`,
    `Clip: ${s.nombre} (${s.clipId})`,
    `Range: ${s.rangeMusical.start} → ${s.rangeMusical.end}`,
    `Notes: ${s.noteCount}`,
    `Pitch: ${s.pitchMin ?? '-'}–${s.pitchMax ?? '-'}`,
    `Velocity: ${s.velocityMin ?? '-'}–${s.velocityMax ?? '-'}`,
    `Density: ${s.densityPerBeat.toFixed(2)} notes/beat`,
    `Channels: ${s.channels.join(',') || '-'}`,
  ].join('\n');
}

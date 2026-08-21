/**
 * Generadores MIDI deterministas para la IA (sin UI).
 */

import type { MidiNote } from '../types/clips';
import { parseRoot, scalePitches, type ScaleType } from './scale';
import { createSeededRandom } from './note-ops';

function id(prefix: string, i: number): string {
  return `${prefix}-${i}`;
}

export type GeneratePatternKind = 'bass_funk' | 'arp' | 'drums' | 'pad_chords';

export interface GeneratePatternOpts {
  kind: GeneratePatternKind;
  bars?: number;
  bpm?: number;
  root?: string;
  scale?: ScaleType;
  seed?: number;
  startBeat?: number;
  channel?: number;
}

export function generateMidiPattern(opts: GeneratePatternOpts): Omit<MidiNote, 'seleccionada' | 'presion'>[] {
  const bars = Math.max(1, Math.min(64, opts.bars ?? 8));
  const root = parseRoot(opts.root ?? 'E');
  const scale = opts.scale ?? 'minor';
  const seed = opts.seed ?? 1;
  const start = opts.startBeat ?? 0;
  const channel = opts.channel ?? 0;
  const rand = createSeededRandom(seed);
  const beats = bars * 4;

  switch (opts.kind) {
    case 'bass_funk':
      return genBassFunk(root, scale, beats, start, channel, rand);
    case 'arp':
      return genArp(root, scale, beats, start, channel, rand);
    case 'drums':
      return genDrums(beats, start, channel, rand);
    case 'pad_chords':
      return genPadChords(root, scale, beats, start, channel);
    default:
      return [];
  }
}

function genBassFunk(
  root: number,
  scale: ScaleType,
  beats: number,
  start: number,
  channel: number,
  rand: () => number,
): Omit<MidiNote, 'seleccionada' | 'presion'>[] {
  const pool = scalePitches(root, scale, 28, 48);
  const rootPitch = pool[0] ?? 28 + root;
  const fifth = pool.find((p) => (p - rootPitch + 12) % 12 === 7) ?? rootPitch + 7;
  const notes: Omit<MidiNote, 'seleccionada' | 'presion'>[] = [];
  let i = 0;
  for (let b = 0; b < beats; b += 0.5) {
    const isDownbeat = b % 1 === 0;
    const isGhost = !isDownbeat && rand() < 0.45;
    if (!isDownbeat && !isGhost && rand() < 0.35) continue;
    const pitch = isDownbeat ? (rand() < 0.7 ? rootPitch : fifth) : pool[Math.floor(rand() * pool.length)]!;
    const vel = isGhost ? 35 + Math.floor(rand() * 25) : 85 + Math.floor(rand() * 30);
    const dur = isGhost ? 0.12 : 0.28 + rand() * 0.2;
    notes.push({
      id: id('bass', i++),
      pitch,
      inicio: start + b + (isGhost ? (rand() - 0.5) * 0.04 : 0),
      duracion: dur,
      velocidad: vel,
      canal: channel,
      articulation: isGhost ? 'ghost' : 'sustain',
      source: 'generated',
      metadata: { pattern: 'bass_funk' },
    });
  }
  return notes;
}

function genArp(
  root: number,
  scale: ScaleType,
  beats: number,
  start: number,
  channel: number,
  rand: () => number,
): Omit<MidiNote, 'seleccionada' | 'presion'>[] {
  const pool = scalePitches(root, scale, 48, 84);
  const chord = [0, 2, 4, 6].map((d) => pool[d % pool.length]!).filter(Boolean);
  const step = 0.25;
  const notes: Omit<MidiNote, 'seleccionada' | 'presion'>[] = [];
  let i = 0;
  let dir = 1;
  let idx = 0;
  for (let t = 0; t < beats; t += step) {
    const pitch = chord[idx]!;
    notes.push({
      id: id('arp', i++),
      pitch,
      inicio: start + t,
      duracion: step * 0.9,
      velocidad: 70 + Math.floor(rand() * 40),
      canal: channel,
      source: 'generated',
      metadata: { pattern: 'arp' },
    });
    idx += dir;
    if (idx >= chord.length - 1 || idx <= 0) dir *= -1;
  }
  return notes;
}

/** GM drum map: kick 36, snare 38, hat closed 42, open 46, tom 45 */
function genDrums(
  beats: number,
  start: number,
  channel: number,
  rand: () => number,
): Omit<MidiNote, 'seleccionada' | 'presion'>[] {
  const notes: Omit<MidiNote, 'seleccionada' | 'presion'>[] = [];
  let i = 0;
  const hit = (pitch: number, beat: number, vel: number, art?: string) => {
    notes.push({
      id: id('drm', i++),
      pitch,
      inicio: start + beat,
      duracion: 0.12,
      velocidad: vel,
      canal: channel,
      articulation: art,
      source: 'generated',
      metadata: { pattern: 'drums' },
    });
  };
  for (let b = 0; b < beats; b++) {
    // kick on 1 and often 3
    if (b % 4 === 0) hit(36, b, 110);
    if (b % 4 === 2 && rand() < 0.85) hit(36, b, 95);
    // snare on 2 and 4
    if (b % 4 === 1 || b % 4 === 3) hit(38, b, 100 + Math.floor(rand() * 15));
    // hats 8ths
    for (let s = 0; s < 2; s++) {
      const t = b + s * 0.5;
      const open = s === 1 && b % 4 === 3 && rand() < 0.3;
      hit(open ? 46 : 42, t, open ? 80 : 55 + Math.floor(rand() * 25), open ? 'open' : 'closed');
    }
    // fill near end of every 8 bars
    if ((b + 1) % 32 === 0) {
      hit(45, b + 0.25, 90);
      hit(47, b + 0.5, 95);
      hit(38, b + 0.75, 115);
    }
  }
  return notes;
}

function genPadChords(
  root: number,
  scale: ScaleType,
  beats: number,
  start: number,
  channel: number,
): Omit<MidiNote, 'seleccionada' | 'presion'>[] {
  const pool = scalePitches(root, scale, 48, 72);
  const notes: Omit<MidiNote, 'seleccionada' | 'presion'>[] = [];
  let i = 0;
  for (let bar = 0; bar < beats / 4; bar++) {
    const base = pool[(bar * 2) % Math.max(1, pool.length - 4)] ?? 60;
    const chord = [0, 2, 4, 6].map((d) => Math.min(127, base + (pool[d] ? pool[d]! - pool[0]! : d * 2)));
    // use scale degrees from pool
    const deg = [0, 2, 4, 6].map((d) => pool[(bar + d) % pool.length]!).filter(Boolean);
    for (const pitch of deg.length ? deg : chord) {
      notes.push({
        id: id('pad', i++),
        pitch,
        inicio: start + bar * 4,
        duracion: 3.8,
        velocidad: 70,
        canal: channel,
        articulation: 'sustain',
        source: 'generated',
        metadata: { pattern: 'pad_chords' },
      });
    }
  }
  return notes;
}

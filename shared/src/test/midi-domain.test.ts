import { describe, it, expect } from 'vitest';
import {
  MIDI_PPQ,
  beatsToTicks,
  ticksToBeats,
  quantizeBeats,
  beatsToMusical,
  musicalToBeats,
  adaptiveGridForZoom,
  transposeNotes,
  quantizeNotes,
  humanizeNotes,
  scaleVelocityRelative,
  getClipSummary,
  getNotes,
  musicalSummaryText,
} from '../midi';
import type { MidiNote } from '../types/clips';
import { crearTiendaDAW, crearEstadoInicial } from '../state';

function note(partial: Partial<MidiNote> & Pick<MidiNote, 'id' | 'pitch' | 'inicio' | 'duracion'>): MidiNote {
  return {
    velocidad: 80,
    canal: 0,
    presion: 0,
    seleccionada: false,
    ...partial,
  };
}

describe('midi ppq / musical time', () => {
  it('converts beats ↔ ticks with PPQ 960', () => {
    expect(beatsToTicks(1)).toBe(MIDI_PPQ);
    expect(ticksToBeats(MIDI_PPQ)).toBe(1);
    expect(beatsToTicks(0.25)).toBe(240);
  });

  it('roundtrips musical position', () => {
    const beats = 4 + 2 + 0.5; // bar 2, beat 3, half beat
    const pos = beatsToMusical(beats, { numerador: 4, denominador: 4 });
    expect(pos.bar).toBe(2);
    expect(pos.beat).toBe(3);
    expect(musicalToBeats(pos)).toBeCloseTo(beats, 5);
  });

  it('quantize strength interpolates', () => {
    const full = quantizeBeats(0.1, 0.25, 1);
    const half = quantizeBeats(0.1, 0.25, 0.5);
    expect(full).toBe(0);
    expect(half).toBeCloseTo(0.05, 5);
  });
});

describe('adaptive grid', () => {
  it('shows more subdivisions at higher zoom', () => {
    const low = adaptiveGridForZoom(10);
    const high = adaptiveGridForZoom(200);
    expect(low.some((l) => l.kind === 'beat')).toBe(true);
    expect(high.some((l) => l.subdivision === '1/64')).toBe(true);
    expect(high.length).toBeGreaterThan(low.length);
  });
});

describe('note ops', () => {
  const notes = [
    note({ id: 'a', pitch: 60, inicio: 0.1, duracion: 0.5, velocidad: 80 }),
    note({ id: 'b', pitch: 64, inicio: 1.1, duracion: 0.5, velocidad: 100 }),
  ];

  it('transpose preserves ids', () => {
    const next = transposeNotes(notes, 2);
    expect(next.map((n) => n.id)).toEqual(['a', 'b']);
    expect(next[0].pitch).toBe(62);
  });

  it('quantize only selected ids', () => {
    const next = quantizeNotes(notes, { gridBeats: 1, strength: 1, noteIds: ['a'] });
    expect(next[0].inicio).toBe(0);
    expect(next[1].inicio).toBe(1.1);
  });

  it('humanize is deterministic with seed', () => {
    const a = humanizeNotes(notes, { seed: 42, timingAmount: 0.05, velocityAmount: 10 });
    const b = humanizeNotes(notes, { seed: 42, timingAmount: 0.05, velocityAmount: 10 });
    expect(a).toEqual(b);
    const c = humanizeNotes(notes, { seed: 99, timingAmount: 0.05, velocityAmount: 10 });
    expect(c[0].inicio).not.toBe(a[0].inicio);
  });

  it('relative velocity preserves dynamics shape', () => {
    const next = scaleVelocityRelative(notes, 1.5);
    const spread0 = notes[1].velocidad - notes[0].velocidad;
    const spread1 = next[1].velocidad - next[0].velocidad;
    expect(spread1).toBeGreaterThan(spread0);
  });
});

describe('midi query + commands', () => {
  it('summary and getNotes work on clip', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await tienda.executor.execute('track.create', { nombre: 'MIDI', tipo: 'midi' });
    const trackId = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!.id;
    await tienda.executor.execute('midi.clip.create', {
      pistaId: trackId,
      nombre: 'Phrase',
      notas: [
        { pitch: 60, inicio: 0, duracion: 1, velocidad: 90 },
        { pitch: 67, inicio: 1, duracion: 1, velocidad: 70 },
      ],
    });
    const clipId = (tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.clips[0] as { id: string }).id;
    const state = tienda.obtenerEstado();
    const summary = getClipSummary(state, clipId, trackId);
    expect(summary?.noteCount).toBe(2);
    expect(getNotes(state, { clipId, pitchMin: 65 }).length).toBe(1);
    expect(musicalSummaryText(state, clipId)).toContain('Notes: 2');

    const beforeIds = getNotes(state, { clipId }).map((n) => n.id);
    await tienda.executor.execute('midi.transpose', { pistaId: trackId, clipId, semitonos: 12 });
    const after = getNotes(tienda.obtenerEstado(), { clipId });
    expect(after.map((n) => n.id)).toEqual(beforeIds);
    expect(after[0].pitch).toBe(72);

    await tienda.executor.execute('midi.quantize', {
      pistaId: trackId,
      clipId,
      gridBeats: 0.25,
      strength: 1,
    });
    await tienda.executor.execute('midi.humanize', {
      pistaId: trackId,
      clipId,
      seed: 7,
      timingAmount: 0.01,
      velocityAmount: 5,
    });
    await tienda.executor.execute('midi.setVelocity', {
      pistaId: trackId,
      clipId,
      relativeFactor: 1.2,
    });
    expect(getNotes(tienda.obtenerEstado(), { clipId }).length).toBe(2);
  });

  it('midi.notes.set preserves provided ids', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await tienda.executor.execute('track.create', { nombre: 'MIDI', tipo: 'midi' });
    const trackId = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!.id;
    await tienda.executor.execute('midi.clip.create', {
      pistaId: trackId,
      notas: [{ pitch: 60, inicio: 0, duracion: 1 }],
    });
    const clipId = (tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.clips[0] as { id: string }).id;
    await tienda.executor.execute('midi.notes.set', {
      pistaId: trackId,
      clipId,
      notas: [{ id: 'stable-1', pitch: 62, inicio: 0, duracion: 1, velocidad: 100 }],
    });
    expect(getNotes(tienda.obtenerEstado(), { clipId })[0].id).toBe('stable-1');
  });

  it('generatePattern and constrainScale work', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await tienda.executor.execute('track.create', { nombre: 'MIDI', tipo: 'midi' });
    const trackId = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'midi')!.id;
    await tienda.executor.execute('midi.generatePattern', {
      pistaId: trackId,
      kind: 'bass_funk',
      bars: 2,
      root: 'E',
      scale: 'minor',
      seed: 3,
    });
    const clipId = (tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.clips[0] as { id: string }).id;
    expect(getNotes(tienda.obtenerEstado(), { clipId }).length).toBeGreaterThan(4);
    await tienda.executor.execute('midi.constrainScale', {
      pistaId: trackId,
      clipId,
      root: 'E',
      scale: 'minor',
    });
    await tienda.executor.execute('midi.makeStaccato', { pistaId: trackId, clipId, ratio: 0.4 });
    await tienda.executor.execute('midi.applyGroove', {
      pistaId: trackId,
      clipId,
      grooveId: 'swing-8',
      strength: 0.7,
      seed: 5,
    });
    await tienda.executor.execute('midi.setCC', {
      pistaId: trackId,
      clipId,
      cc: 1,
      puntos: [
        { tiempo: 0, valor: 0 },
        { tiempo: 2, valor: 1 },
      ],
    });
    await tienda.executor.execute('midi.setPitchBend', {
      pistaId: trackId,
      clipId,
      puntos: [
        { tiempo: 0, valor: 0 },
        { tiempo: 1, valor: 0.5 },
      ],
    });
    const clip = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.clips[0] as {
      expression?: { cc: { cc: number }[]; pitchBend: unknown[] };
    };
    expect(clip.expression?.cc.some((l) => l.cc === 1)).toBe(true);
    expect(clip.expression?.pitchBend.length).toBe(2);
  });
});

import { describe, it, expect } from 'vitest';
import { computeSemanticDiff } from '@jaswave/shared';

function makeState(tracks: any[]): any {
  return {
    project: {
      tracks,
      routing: { sends: [], sidechains: [] },
    },
  };
}

describe('run.diff EQ dB/Hz', () => {
  it('detecta cambio de volumen con unidad dB', () => {
    const before = makeState([
      { id: 't1', nombre: 'EQ', volumen: -6, paneo: 0, silenciada: false, clips: [], plugins: [] },
    ]);
    const after = makeState([
      { id: 't1', nombre: 'EQ', volumen: -3, paneo: 0, silenciada: false, clips: [], plugins: [] },
    ]);
    const diff = computeSemanticDiff(before, after);
    expect(diff.volumeChanges.length).toBe(1);
    expect(diff.volumeChanges[0].unit).toBe('dB');
    expect(diff.volumeChanges[0].before).toBe(-6);
    expect(diff.volumeChanges[0].after).toBe(-3);
  });

  it('detecta carga de plugin y cambios de parámetros con unidad', () => {
    const before = makeState([
      { id: 't1', nombre: 'Canal', volumen: 0, clips: [], plugins: [] },
    ]);
    const after = makeState([
      {
        id: 't1',
        nombre: 'Canal',
        volumen: 0,
        clips: [],
        plugins: [
          {
            id: 'p1',
            nombre: 'EQ',
            parametros: [
              { id: 'freq', nombre: 'Freq', valor: 1000, minimo: 20, maximo: 20000, paso: 1, unidad: 'Hz', etiqueta: 'Freq' },
              { id: 'gain', nombre: 'Gain', valor: 0, minimo: -18, maximo: 18, paso: 0.1, unidad: 'dB', etiqueta: 'Gain' },
            ],
          },
        ],
      },
    ]);
    const diff = computeSemanticDiff(before, after);
    expect(diff.pluginsLoaded.length).toBe(1);
    expect(diff.pluginsLoaded[0].pluginName).toBe('EQ');
  });

  it('detecta cambio de parámetro de plugin con unidad Hz/dB', () => {
    const before = makeState([
      {
        id: 't1',
        nombre: 'Canal',
        volumen: 0,
        clips: [],
        plugins: [
          {
            id: 'p1',
            nombre: 'EQ',
            parametros: [
              { id: 'freq', nombre: 'Freq', valor: 1000, minimo: 20, maximo: 20000, paso: 1, unidad: 'Hz', etiqueta: 'Freq' },
            ],
          },
        ],
      },
    ]);
    const after = makeState([
      {
        id: 't1',
        nombre: 'Canal',
        volumen: 0,
        clips: [],
        plugins: [
          {
            id: 'p1',
            nombre: 'EQ',
            parametros: [
              { id: 'freq', nombre: 'Freq', valor: 2000, minimo: 20, maximo: 20000, paso: 1, unidad: 'Hz', etiqueta: 'Freq' },
            ],
          },
        ],
      },
    ]);
    const diff = computeSemanticDiff(before, after);
    expect(diff.pluginParamChanges.length).toBe(1);
    expect(diff.pluginParamChanges[0].unit).toBe('Hz');
    expect(diff.pluginParamChanges[0].paramId).toBe('freq');
  });
});

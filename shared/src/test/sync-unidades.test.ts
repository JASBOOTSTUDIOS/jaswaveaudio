import { describe, it, expect } from 'vitest';
import { comparar, fusionar, incrementar } from '../sync/reloj-vectorial';
import { conEntorno, entorno } from '../state/entorno-determinista';
import { serializarInstantanea, deserializarInstantanea } from '../sync/instantanea-serializable';
import { capturarInstantaneaParcial, aplicarInstantaneaParcial } from '../state/instantanea-parcial';
import { aplicarParcheNotas, parcheNotas } from '../commands/domain-commands';
import { crearTiendaDAW, crearEstadoInicial } from '../state';
import type { MidiNote } from '../types/clips';

const nota = (id: string, pitch: number, inicio = 0): MidiNote =>
  ({ id, pitch, inicio, duracion: 1, velocidad: 90, canal: 0, presion: 0, seleccionada: false }) as MidiNote;

describe('reloj vectorial', () => {
  it('distingue causalidad y concurrencia', () => {
    const a1 = incrementar({}, 'A');
    const b1 = incrementar({}, 'B');
    expect(comparar(a1, b1)).toBe('concurrente');
    const ab = fusionar(a1, b1);
    expect(comparar(a1, ab)).toBe('antes');
    expect(comparar(incrementar(ab, 'A'), ab)).toBe('despues');
    expect(comparar(ab, { ...ab })).toBe('igual');
  });
});

describe('entorno determinista', () => {
  it('el mismo entorno produce los mismos ids y tiempos; fuera de él se usan los reales', async () => {
    const e = { ahora: 1_700_000_000_000, semilla: 12345 };
    const a = await conEntorno(e, () => [entorno.uuid(), entorno.aleatorio(), entorno.ahora()]);
    const b = await conEntorno(e, () => [entorno.uuid(), entorno.aleatorio(), entorno.ahora()]);
    expect(a).toEqual(b);
    expect(a[2]).toBe(e.ahora);
    expect(a[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(entorno.ahora()).not.toBe(e.ahora);
  });

  it('dos tiendas que ejecutan el mismo comando con el mismo entorno quedan idénticas', async () => {
    const base = crearEstadoInicial();
    const e = { ahora: 1_700_000_000_000, semilla: 7 };
    const [x, y] = [crearTiendaDAW({ estadoInicial: structuredClone(base) }), crearTiendaDAW({ estadoInicial: structuredClone(base) })];
    await x.executor.execute('track.create', { nombre: 'P', tipo: 'midi' }, 'user', undefined, { entorno: e });
    await y.executor.execute('track.create', { nombre: 'P', tipo: 'midi' }, 'user', undefined, { entorno: e });
    expect(JSON.stringify(x.obtenerEstado().project)).toBe(JSON.stringify(y.obtenerEstado().project));
  });
});

describe('instantánea serializable', () => {
  it('sobrevive a JSON, incluidas las claves borradas', async () => {
    const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await t.executor.execute('track.create', { nombre: 'P', tipo: 'midi' });
    const base = t.obtenerEstado();
    const pista = base.project.tracks[0]!;
    // 'etiquetaTemporal' existe antes y se elimina después: JSON perdería ese borrado si no se codificara.
    const antes = { ...base, project: { ...base.project, etiquetaTemporal: 'x' } as typeof base.project };
    const { etiquetaTemporal: _quitada, ...sinEtiqueta } = antes.project as typeof antes.project & { etiquetaTemporal?: string };
    const despues = {
      ...antes,
      project: {
        ...sinEtiqueta,
        nombre: 'Renombrado',
        tracks: antes.project.tracks.map((p) => (p.id === pista.id ? { ...p, color: '#00ffcc' } : p)),
      } as typeof antes.project,
    };
    const inst = capturarInstantaneaParcial(antes, despues)!;
    const viaje = deserializarInstantanea(JSON.parse(JSON.stringify(serializarInstantanea(inst))));
    const aplicado = aplicarInstantaneaParcial(antes, viaje, 'despues');
    expect(aplicado.project.nombre).toBe('Renombrado');
    expect(aplicado.project.tracks.find((p) => p.id === pista.id)?.color).toBe('#00ffcc');
    expect('etiquetaTemporal' in aplicado.project).toBe(false);
  });
});

describe('parche de notas', () => {
  it('ida y vuelta conserva orden e ids', () => {
    const desde = [nota('a', 60), nota('b', 62), nota('c', 64)];
    const hacia = [nota('a', 61), nota('c', 64), nota('d', 67)];
    expect(aplicarParcheNotas(desde, parcheNotas(desde, hacia))).toEqual(hacia);
    expect(aplicarParcheNotas(hacia, parcheNotas(hacia, desde))).toEqual(desde);
  });

  it('el inverso solo toca las notas propias: respeta notas ajenas añadidas después', () => {
    const antes = [nota('a', 60)];
    const mio = [...antes, nota('mia', 64)];
    const inverso = parcheNotas(mio, antes);
    const conAjena = [...mio, nota('ajena', 67)];
    expect(aplicarParcheNotas(conAjena, inverso).map((n) => n.id)).toEqual(['a', 'ajena']);
  });
});

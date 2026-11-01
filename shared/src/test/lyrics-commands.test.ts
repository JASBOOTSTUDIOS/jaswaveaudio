/**
 * Comandos `lyrics.*` / `chords.*`: ida y vuelta de undo/redo, validación y herramientas IA.
 */
import { describe, expect, it } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import type { DAWState } from '../types/state';

type Tienda = ReturnType<typeof crearTiendaDAW>;
const nuevaTienda = (): Tienda => crearTiendaDAW({ estadoInicial: crearEstadoInicial() });

async function ok(tienda: Tienda, type: string, payload: unknown) {
  const r = await tienda.executor.execute(type, payload, 'user');
  expect(r.success, `${type}: ${r.error?.message ?? ''}`).toBe(true);
  return r;
}

function comparable(s: DAWState): unknown {
  return JSON.parse(JSON.stringify(s.project, (k, v) => (k === 'fechaModificacion' || k === 'modificado' || k === 'revision' ? undefined : v)));
}

async function roundTrip(tienda: Tienda, type: string, payload: unknown) {
  const antes = comparable(tienda.obtenerEstado());
  const depth = tienda.executor.getUndoDepth();
  const r = await ok(tienda, type, payload);
  const despues = comparable(tienda.obtenerEstado());
  expect(despues, `${type} debe cambiar el proyecto`).not.toEqual(antes);
  expect(tienda.executor.getUndoDepth(), `${type} entra en la pila`).toBe(depth + 1);
  expect((await tienda.executor.undo()).success).toBe(true);
  expect(comparable(tienda.obtenerEstado()), `undo de ${type}`).toEqual(antes);
  expect((await tienda.executor.redo()).success).toBe(true);
  expect(comparable(tienda.obtenerEstado()), `redo de ${type}`).toEqual(despues);
  return r;
}

const letra = (t: Tienda) => t.obtenerEstado().project.letra ?? { frases: [], acordes: [] };

describe('lyrics/chords · undo round-trip', () => {
  it('acordes: set, upsert, move, remove, clear', async () => {
    const t = nuevaTienda();
    await roundTrip(t, 'lyrics.setChords', { acordes: [{ nombre: 'D', compas: 1 }, { nombre: 'Bm7', compas: 2 }, { nombre: 'G/B', beat: 8, duracion: 2 }] });
    expect(letra(t).acordes.map((a) => [a.nombre, a.beat, a.duracion])).toEqual([['D', 0, 4], ['Bm7', 4, 4], ['G/B', 8, 2]]);

    const up = await roundTrip(t, 'chords.upsert', { nombre: 'a7sus4', compas: 4 });
    const id = (up.result as { id: string }).id;
    expect(letra(t).acordes.find((a) => a.id === id)?.nombre).toBe('A7sus4');
    // Mismo beat sin id → sustituye
    await roundTrip(t, 'chords.upsert', { nombre: 'Asus4', beat: 12 });
    expect(letra(t).acordes.filter((a) => a.beat === 12)).toHaveLength(1);
    expect(letra(t).acordes.find((a) => a.beat === 12)?.id).toBe(id);

    await roundTrip(t, 'chords.move', { id, beat: 14, duracion: 2 });
    expect(letra(t).acordes.find((a) => a.id === id)?.beat).toBe(14);
    await roundTrip(t, 'chords.remove', { id });
    expect(letra(t).acordes.some((a) => a.id === id)).toBe(false);
    await roundTrip(t, 'lyrics.clear', { que: 'acordes' });
    expect(letra(t).acordes).toHaveLength(0);
  });

  it('letra: setPhrases por texto, alignTiming y clear', async () => {
    const t = nuevaTienda();
    await ok(t, 'marker.create', { tiempo: 0, nombre: 'Verso' });
    await ok(t, 'marker.create', { tiempo: 16, nombre: 'Coro' });
    await roundTrip(t, 'lyrics.setPhrases', { texto: 'Tu presencia Señor\nllena este lugar\n\nSanto santo' });
    const frases = letra(t).frases;
    expect(frases).toHaveLength(3);
    expect(frases.map((f) => f.seccion)).toEqual(['Verso', 'Verso', 'Coro']);
    expect(frases[0]!.silabas.map((s) => s.texto)).toEqual(['Tu', 'pre', 'sen', 'cia', 'Se', 'ñor']);
    expect(frases[2]!.silabas[0]!.beat).toBe(16);

    await roundTrip(t, 'lyrics.alignTiming', { frases: [{ id: frases[0]!.id, inicioBeat: 2, duracionBeats: 6 }] });
    expect(letra(t).frases[0]!.silabas[0]!.beat).toBe(2);
    await roundTrip(t, 'lyrics.alignTiming', { cambios: [{ fraseId: frases[0]!.id, indice: 1, beat: 3.5 }] });
    expect(letra(t).frases[0]!.silabas[1]!.beat).toBe(3.5);
    await roundTrip(t, 'lyrics.clear', {});
    expect(letra(t).frases).toHaveLength(0);
  });

  it('frases explícitas con sílabas propias y sin secciones', async () => {
    const t = nuevaTienda();
    await ok(t, 'lyrics.setPhrases', {
      frases: [
        { texto: 'Hola', silabas: [{ texto: 'Ho', beat: 0, duracion: 1, nota: 62 }, { texto: 'la', beat: 1, duracion: 1 }] },
        { texto: 'mundo', inicioBeat: 4, duracionBeats: 2 },
        { texto: 'otra' },
      ],
    });
    const f = letra(t).frases;
    expect(f[0]!.silabas[0]!.nota).toBe(62);
    expect(f[1]!.silabas.map((s) => s.beat)).toEqual([4, 5]);
    // La tercera arranca donde acaba la anterior y ocupa 2 compases por defecto
    expect(f[2]!.silabas[0]!.beat).toBe(6);
  });
});

describe('lyrics/chords · herramientas IA', () => {
  it('chords.set por texto y chords.get', async () => {
    const t = nuevaTienda();
    await ok(t, 'chords.set', { texto: '| D | Bm | G A | Asus4 |' });
    const g = await ok(t, 'chords.get', {});
    const r = g.result as { acordes: Array<{ nombre: string; compas: number }>; texto: string };
    expect(r.acordes.map((a) => [a.nombre, a.compas])).toEqual([['D', 1], ['Bm', 2], ['G', 3], ['A', 3], ['Asus4', 4]]);
    expect(r.texto).toBe('| D | Bm | G A | Asus4 |');
    expect(t.executor.getUndoDepth()).toBe(1); // la lectura no entra en la pila
  });

  it('chords.set por secciones crea marcadores en un solo paso de undo', async () => {
    const t = nuevaTienda();
    await roundTrip(t, 'chords.set', {
      secciones: [
        { nombre: 'Verso', compases: 4, acordes: ['D', 'Bm', 'G', 'A'] },
        { nombre: 'Coro', compases: 2, acordes: ['G A', 'D'] },
      ],
    });
    const s = t.obtenerEstado();
    expect(s.project.marcadores.map((m) => [m.nombre, m.tiempo])).toEqual([['Verso', 0], ['Coro', 16]]);
    expect(s.project.letra!.acordes.map((a) => a.nombre)).toEqual(['D', 'Bm', 'G', 'A', 'G', 'A', 'D']);
    expect(s.project.letra!.acordes[5]).toMatchObject({ beat: 18, duracion: 2 });
    // Repetir no duplica marcadores
    await ok(t, 'chords.set', { secciones: [{ nombre: 'Verso', compases: 4, acordes: ['D'] }] });
    expect(t.obtenerEstado().project.marcadores).toHaveLength(2);
  });

  it('lyrics.set y lyrics.get', async () => {
    const t = nuevaTienda();
    await ok(t, 'lyrics.set', { texto: 'Grande es tu fidelidad\nOh Dios', compasesPorFrase: 1 });
    const g = await ok(t, 'lyrics.get', {});
    const r = g.result as { frases: Array<{ texto: string; compas: number }>; texto: string };
    expect(r.frases.map((f) => [f.texto, f.compas])).toEqual([['Grande es tu fidelidad', 1], ['Oh Dios', 2]]);
    expect(r.texto).toBe('Grande es tu fidelidad\nOh Dios');
  });

  it('validación: acordes y tiempos inválidos se rechazan sin tocar el estado', async () => {
    const t = nuevaTienda();
    const antes = comparable(t.obtenerEstado());
    for (const [type, payload] of [
      ['chords.upsert', { nombre: 'Hm', compas: 1 }],
      ['chords.upsert', { nombre: 'D', beat: -1 }],
      ['chords.upsert', { nombre: 'D', beat: 0, duracion: 0 }],
      ['lyrics.setChords', { acordes: [{ nombre: 'D', compas: 0 }] }],
      ['chords.set', { texto: '| D | Xyz |' }],
      ['lyrics.setPhrases', { frases: [{ texto: '   ' }] }],
      ['lyrics.set', { texto: '' }],
      ['chords.move', { id: 'no-existe', beat: 1 }],
      ['chords.remove', { id: 'no-existe' }],
    ] as Array<[string, unknown]>) {
      const r = await t.executor.execute(type, payload, 'user');
      expect(r.success, `${type} ${JSON.stringify(payload)} debería fallar`).toBe(false);
    }
    expect(comparable(t.obtenerEstado())).toEqual(antes);
    expect(t.executor.getUndoDepth()).toBe(0);
  });

  it('la letra sobrevive a la serialización', async () => {
    const t = nuevaTienda();
    await ok(t, 'chords.set', { texto: 'D Bm' });
    await ok(t, 'lyrics.set', { texto: 'Santo' });
    const { serializarEstado, deserializarEstado } = await import('../state/serializar-estado');
    const copia = deserializarEstado(serializarEstado(t.obtenerEstado()));
    expect(copia.project.letra).toEqual(t.obtenerEstado().project.letra);
  });
});

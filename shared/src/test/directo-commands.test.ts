/**
 * K3 · Modo Directo: zonas MIDI, seguridad del máster y bloqueo, con undo/redo.
 */
import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { aplicarZonaANota, normalizarZona, notasDeSalidaParaPista, velocidadConCurva, type ZonaMidi } from '../types/directo';

type Tienda = ReturnType<typeof crearTiendaDAW>;

const nuevaTienda = (): Tienda => crearTiendaDAW({ estadoInicial: crearEstadoInicial() });

async function ok(tienda: Tienda, type: string, payload: unknown) {
  const r = await tienda.executor.execute(type, payload, 'user');
  expect(r.success, `${type}: ${r.error?.message ?? ''}`).toBe(true);
  return r;
}

async function crearPista(tienda: Tienda, nombre: string): Promise<string> {
  const r = await ok(tienda, 'track.create', { nombre, tipo: 'midi' });
  return (r.result as { trackId: string }).trackId;
}

const zonas = (t: Tienda) => t.obtenerEstado().project.directo?.zonas ?? [];

describe('K3 · comandos de zonas MIDI', () => {
  it('midi.zones.add normaliza, midi.zones.update cambia y midi.zones.remove quita, todo con undo/redo', async () => {
    const tienda = nuevaTienda();
    const pista = await crearPista(tienda, 'Piano');
    const r = await ok(tienda, 'midi.zones.add', { pistaId: pista, lo: 70, hi: 20, transposicion: 90, curvaVelocidad: 'rara', canalSalida: 40 });
    const { zonaId } = r.result as { zonaId: string };
    expect(zonas(tienda)).toHaveLength(1);
    const z = zonas(tienda)[0]!;
    expect(z.id).toBe(zonaId);
    expect([z.lo, z.hi]).toEqual([20, 70]); // lo ≤ hi
    expect(z.transposicion).toBe(60); // clamp
    expect(z.curvaVelocidad).toBe('lineal'); // curva desconocida → lineal
    expect(z.canalSalida).toBe(16);
    expect(z.activa).toBe(true);

    await ok(tienda, 'midi.zones.update', { zonaId, cambios: { transposicion: -12, curvaVelocidad: 'suave', canalSalida: undefined } });
    expect(zonas(tienda)[0]).toMatchObject({ transposicion: -12, curvaVelocidad: 'suave' });
    expect(zonas(tienda)[0]!.canalSalida).toBeUndefined();

    await tienda.executor.undo();
    expect(zonas(tienda)[0]).toMatchObject({ transposicion: 60, canalSalida: 16 });
    await tienda.executor.redo();
    expect(zonas(tienda)[0]).toMatchObject({ transposicion: -12 });

    await ok(tienda, 'midi.zones.remove', { zonaId });
    expect(zonas(tienda)).toHaveLength(0);
    await tienda.executor.undo();
    expect(zonas(tienda)).toHaveLength(1);
    await tienda.executor.undo(); // deshace el update
    await tienda.executor.undo(); // deshace el add
    expect(zonas(tienda)).toHaveLength(0);
    await tienda.executor.redo();
    expect(zonas(tienda)).toHaveLength(1);
    expect(zonas(tienda)[0]!.id).toBe(zonaId); // redo determinista: mismo id
  });

  it('midi.zones.set sustituye solo las zonas de la pista indicada y rechaza pistas inexistentes', async () => {
    const tienda = nuevaTienda();
    const piano = await crearPista(tienda, 'Piano');
    const bajo = await crearPista(tienda, 'Bajo');
    await ok(tienda, 'midi.zones.set', {
      zonas: [
        { pistaId: bajo, lo: 0, hi: 59, transposicion: 12 },
        { pistaId: piano, lo: 60, hi: 127 },
      ],
    });
    expect(zonas(tienda)).toHaveLength(2);
    await ok(tienda, 'midi.zones.set', { pistaId: piano, zonas: [{ lo: 48, hi: 127 }, { lo: 48, hi: 72, transposicion: 12 }] });
    expect(zonas(tienda)).toHaveLength(3);
    expect(zonas(tienda).filter((z) => z.pistaId === bajo)).toHaveLength(1);
    expect(zonas(tienda).filter((z) => z.pistaId === piano).map((z) => z.lo)).toEqual([48, 48]);

    const mal = await tienda.executor.execute('midi.zones.set', { zonas: [{ pistaId: 'no-existe', lo: 0, hi: 10 }] }, 'user');
    expect(mal.success).toBe(false);
    const malRemove = await tienda.executor.execute('midi.zones.remove', { zonaId: 'nada' }, 'user');
    expect(malRemove.success).toBe(false);

    await tienda.executor.undo();
    expect(zonas(tienda)).toHaveLength(2);
    await tienda.executor.undo();
    expect(zonas(tienda)).toHaveLength(0);
  });

  it('directo.setSafety y directo.setLock', async () => {
    const tienda = nuevaTienda();
    expect(tienda.obtenerEstado().project.directo).toBeUndefined();
    await ok(tienda, 'directo.setSafety', { activa: true });
    expect(tienda.obtenerEstado().project.directo?.seguridad).toEqual({ activa: true, techoDb: -0.5 });
    await ok(tienda, 'directo.setSafety', { techoDb: -1 });
    expect(tienda.obtenerEstado().project.directo?.seguridad).toEqual({ activa: true, techoDb: -1 });
    const mal = await tienda.executor.execute('directo.setSafety', { techoDb: 3 }, 'user');
    expect(mal.success).toBe(false);
    await tienda.executor.undo();
    expect(tienda.obtenerEstado().project.directo?.seguridad.techoDb).toBe(-0.5);

    const profundidad = tienda.executor.getUndoDepth();
    await ok(tienda, 'directo.setLock', { bloqueo: true });
    expect(tienda.obtenerEstado().project.directo?.bloqueo).toBe(true);
    expect(tienda.executor.getUndoDepth()).toBe(profundidad); // el bloqueo no entra en la pila de undo
    await ok(tienda, 'directo.setLock', { bloqueo: false });
    expect(tienda.obtenerEstado().project.directo?.bloqueo).toBe(false);
  });
});

describe('K3 · funciones puras de zona', () => {
  const base: ZonaMidi = normalizarZona({ id: 'z', pistaId: 'p', lo: 48, hi: 72, transposicion: 12 });

  it('rango, transposición con clamp y canal', () => {
    expect(aplicarZonaANota(base, 47, 100)).toBeNull();
    expect(aplicarZonaANota(base, 48, 100)).toMatchObject({ pitch: 60, velocidad: 100, canal: 1 });
    expect(aplicarZonaANota(base, 72, 100, 3)).toMatchObject({ pitch: 84, canal: 3 });
    expect(aplicarZonaANota(base, 73, 100)).toBeNull();
    const arriba = normalizarZona({ id: 'a', pistaId: 'p', lo: 0, hi: 127, transposicion: 60 });
    expect(aplicarZonaANota(arriba, 120, 100)!.pitch).toBe(127);
    const abajo = normalizarZona({ id: 'b', pistaId: 'p', lo: 0, hi: 127, transposicion: -60 });
    expect(aplicarZonaANota(abajo, 10, 100)!.pitch).toBe(0);
    expect(aplicarZonaANota({ ...base, canalEntrada: 2 }, 60, 100, 1)).toBeNull();
    expect(aplicarZonaANota({ ...base, canalEntrada: 2, canalSalida: 5 }, 60, 100, 2)!.canal).toBe(5);
    expect(aplicarZonaANota({ ...base, activa: false }, 60, 100)).toBeNull();
  });

  it('curvas de velocidad', () => {
    const lineal = { curvaVelocidad: 'lineal' as const, escalaVelocidad: 1, velocidadFija: 100 };
    expect(velocidadConCurva(64, lineal)).toBe(64);
    expect(velocidadConCurva(64, { ...lineal, escalaVelocidad: 2 })).toBe(127);
    expect(velocidadConCurva(64, { ...lineal, curvaVelocidad: 'suave' })).toBeGreaterThan(64);
    expect(velocidadConCurva(64, { ...lineal, curvaVelocidad: 'dura' })).toBeLessThan(64);
    expect(velocidadConCurva(1, { ...lineal, curvaVelocidad: 'fija', velocidadFija: 90 })).toBe(90);
    expect(velocidadConCurva(0, lineal)).toBe(1); // nunca 0 (sería note-off)
  });

  it('sin zonas la nota pasa tal cual; con zonas, una salida por zona que la acepte', () => {
    expect(notasDeSalidaParaPista([], 'p', 60, 90)).toEqual([{ pitch: 60, velocidad: 90, canal: 1 }]);
    const capa = normalizarZona({ id: 'c', pistaId: 'p', lo: 48, hi: 72, transposicion: 0 });
    const otraPista = normalizarZona({ id: 'o', pistaId: 'q', lo: 0, hi: 127 });
    const salidas = notasDeSalidaParaPista([base, capa, otraPista], 'p', 60, 90);
    expect(salidas.map((n) => n.pitch)).toEqual([72, 60]);
    expect(notasDeSalidaParaPista([base, capa], 'p', 40, 90)).toEqual([]);
    // Dos zonas que caen en el mismo tono se funden.
    expect(notasDeSalidaParaPista([capa, { ...capa, id: 'c2' }], 'p', 60, 90)).toHaveLength(1);
  });
});

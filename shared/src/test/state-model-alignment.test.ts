/**
 * Tests de alineación del State Model: undo de dominio, serialización,
 * operaciones export/clone/reset y selección.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearTiendaDAW } from '../state/tienda';
import { ConsultaDAW } from '../state/consulta';
import { serializarEstado, deserializarEstado } from '../state/serializar-estado';
import { exportarEstadoDAW, clonarEstadoDAW, resetearEstadoDAW } from '../state/operaciones-estado';
import { crearObservadorEstado } from '../state/watch';

describe('State Model alignment', () => {
  let tienda: ReturnType<typeof crearTiendaDAW>;

  beforeEach(() => {
    tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
  });

  it('undo revierte track.create vía inversePayload', async () => {
    const antes = tienda.obtenerEstado().project.tracks.length;
    const res = await tienda.executor.execute('track.create', { nombre: 'Undoable', tipo: 'audio' });
    expect(res.success).toBe(true);
    expect(tienda.obtenerEstado().project.tracks.length).toBe(antes + 1);
    expect(tienda.executor.canUndo()).toBe(true);

    const undo = await tienda.executor.undo();
    expect(undo?.success).toBe(true);
    expect(tienda.obtenerEstado().project.tracks.length).toBe(antes);
  });

  it('undo revierte track.toggleMute (self-inverse)', async () => {
    await tienda.executor.execute('track.create', { nombre: 'Mute', tipo: 'audio' });
    const id = tienda.obtenerEstado().project.tracks[tienda.obtenerEstado().project.tracks.length - 1]!.id;
    expect(tienda.obtenerEstado().project.tracks.find(t => t.id === id)?.silenciada).toBe(false);

    await tienda.executor.execute('track.toggleMute', { trackId: id });
    expect(tienda.obtenerEstado().project.tracks.find(t => t.id === id)?.silenciada).toBe(true);

    await tienda.executor.undo();
    expect(tienda.obtenerEstado().project.tracks.find(t => t.id === id)?.silenciada).toBe(false);
  });

  it('selection.set/clear mutan vía comandos sin llenar undo', async () => {
    await tienda.executor.execute('selection.set', {
      idsClips: ['c1'],
      idsPistas: [],
      tipo: 'clip',
      idPrincipal: 'c1',
    });
    expect(tienda.obtenerEstado().selection.idsClips).toEqual(['c1']);
    // selection no tiene inverseType → no debe aumentar la pila por encima de 0
    expect(tienda.executor.canUndo()).toBe(false);

    await tienda.executor.execute('selection.clear', { alcance: 'clips' });
    expect(tienda.obtenerEstado().selection.idsClips).toEqual([]);
  });

  it('ui.setPalette sincroniza paletaComandosAbierta', async () => {
    await tienda.executor.execute('ui.setPalette', { abierta: true });
    expect(tienda.obtenerEstado().ui.paletaComandosAbierta).toBe(true);
    await tienda.executor.execute('ui.setPalette', { abierta: false });
    expect(tienda.obtenerEstado().ui.paletaComandosAbierta).toBe(false);
  });

  it('serializarEstado / deserializarEstado round-trip', () => {
    const estado = tienda.obtenerEstado();
    estado.cache.archivos.set('k', {
      datos: new ArrayBuffer(8),
      marcaTiempo: 1,
      ultimoAcceso: 1,
    });
    const json = serializarEstado(estado);
    const restored = deserializarEstado(json);
    expect(restored.project.nombre).toBe(estado.project.nombre);
    expect(restored.cache.archivos instanceof Map).toBe(true);
    expect(restored.cache.archivos.get('k')?.datos).toBeInstanceOf(ArrayBuffer);
  });

  it('exportar / clonar / resetear estado', () => {
    const estado = tienda.obtenerEstado();
    const exp = exportarEstadoDAW(estado, { incluirUI: true, incluirProyecto: true });
    expect(exp.json.length).toBeGreaterThan(10);
    const clon = clonarEstadoDAW(estado, { nombre: 'Clon', limpiarIdentificadores: true });
    expect(clon.project.nombre).toBe('Clon');
    expect(clon.project.id).not.toBe(estado.project.id);
    const reset = resetearEstadoDAW(estado, { mantenerProyecto: false, mantenerUI: false });
    expect(reset.project.tracks.length).toBe(crearEstadoInicial().project.tracks.length);
  });

  it('ConsultaDAW.duplicarPista planifica sin mutar', async () => {
    await tienda.executor.execute('track.create', { nombre: 'Orig', tipo: 'audio' });
    const estado = tienda.obtenerEstado();
    const id = estado.project.tracks[estado.project.tracks.length - 1]!.id;
    const consulta = new ConsultaDAW(estado);
    const dup = consulta.duplicarPista(id);
    expect(dup.resultado.exito).toBe(true);
    expect(dup.tipo).toBe('pista');
    if (dup.tipo === 'pista') {
      expect(dup.pistasDuplicadas.length).toBe(1);
    }
    expect(tienda.obtenerEstado().project.tracks.length).toBe(estado.project.tracks.length);
  });

  it('crearObservadorEstado notifica cambios de campo', async () => {
    const cambios: string[] = [];
    const obs = crearObservadorEstado(tienda);
    const cancelar = obs.registrar({
      id: 'w1',
      nombre: 'tracks',
      activo: true,
      campos: ['project'],
      inmediato: false,
      callback: (_e, _a, c) => {
        cambios.push(...c);
      },
    });
    await tienda.executor.execute('track.create', { nombre: 'Watch', tipo: 'audio' });
    expect(cambios.length).toBeGreaterThan(0);
    cancelar();
  });
});

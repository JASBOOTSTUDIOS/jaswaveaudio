/**
 * U2 · Undo limpio: autosave invisible, transporte fuera de la pila,
 * coalescencia por gesto, instantáneas para comandos sin inverso, lotes y
 * `clipInicio` en clip.create.
 */
import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import type { DAWState } from '../types/state';
import type { Track } from '../types/tracks';
import type { PluginInfo } from '../types/entidades';

type Tienda = ReturnType<typeof crearTiendaDAW>;

const nuevaTienda = (): Tienda => crearTiendaDAW({ estadoInicial: crearEstadoInicial() });

async function ok(tienda: Tienda, type: string, payload: unknown, opciones?: { coalesceKey?: string; gestureId?: string }) {
  const r = await tienda.executor.execute(type, payload, 'user', undefined, opciones);
  expect(r.success, `${type}: ${r.error?.message ?? ''}`).toBe(true);
  return r;
}

async function crearPista(tienda: Tienda, nombre: string, tipo: 'audio' | 'midi' = 'audio'): Promise<string> {
  const r = await ok(tienda, 'track.create', { nombre, tipo });
  return (r.result as { trackId: string }).trackId;
}

const pistaDe = (s: DAWState, id: string): Track => s.project.tracks.find((t) => t.id === id)!;

/** Proyecto comparable: sin marcas de tiempo ni `modificado`. */
function comparable(s: DAWState): unknown {
  return JSON.parse(
    JSON.stringify(s.project, (k, v) => (k === 'fechaModificacion' || k === 'modificado' || k === 'revision' ? undefined : v)),
  );
}

function pluginVst(id: string): PluginInfo {
  return {
    id,
    nombre: 'Synth',
    fabricante: 'X',
    tipo: 'instrumento',
    bypass: false,
    parametros: [{ id: 'p1', nombre: 'Cutoff', valor: 0.5, minimo: 0, maximo: 1, paso: 0.001, unidad: '', etiqueta: 'Cutoff' }],
    estado: 'cargado',
    version: '1',
    wet: 1,
    latencia: 0,
    categoria: 'synth',
    autor: '',
    licencia: '',
    descripcion: 'C:/VST3/Synth.vst3',
    estadoPluginBase64: 'AAAA',
  } as unknown as PluginInfo;
}

/** Inserta un plugin directamente en el estado (fuera de la pila) y marca el proyecto como guardado. */
function sembrarPlugins(tienda: Tienda, trackId: string): void {
  const s = tienda.obtenerEstado();
  tienda.executor.reemplazarEstado({
    ...s,
    project: {
      ...s.project,
      modificado: false,
      master: { ...s.project.master, plugins: [pluginVst('m1')] },
      tracks: s.project.tracks.map((t) => (t.id === trackId ? ({ ...t, plugins: [pluginVst('v1')] } as Track) : t)),
    },
  });
}

describe('U2 · snapshot de plugins del autosave', () => {
  it('track/master.snapshotPluginState no tocan la pila, el redo ni `modificado`', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Synth', 'midi');
    await ok(tienda, 'project.setBpm', { bpm: 100 });
    await tienda.executor.undo(); // deja algo en redo
    sembrarPlugins(tienda, trackId);
    const undoAntes = tienda.executor.getUndoDepth();
    expect(tienda.executor.canRedo()).toBe(true);

    await ok(tienda, 'track.snapshotPluginState', {
      trackId,
      pluginInstanceId: 'v1',
      estadoPluginBase64: 'BBBB',
      parametros: [{ ...pluginVst('v1').parametros[0]!, valor: 0.9 }],
    });
    await ok(tienda, 'master.snapshotPluginState', { pluginInstanceId: 'm1', estadoPluginBase64: 'CCCC' });

    const s = tienda.obtenerEstado();
    expect(pistaDe(s, trackId).plugins![0]!.estadoPluginBase64).toBe('BBBB');
    expect(pistaDe(s, trackId).plugins![0]!.parametros[0]!.valor).toBe(0.9);
    // El master ahora sí guarda el estado de sus plugins (antes project.update lo ignoraba).
    expect(s.project.master.plugins![0]!.estadoPluginBase64).toBe('CCCC');
    expect(s.project.modificado).toBe(false);
    expect(tienda.executor.getUndoDepth()).toBe(undoAntes);
    expect(tienda.executor.canRedo()).toBe(true);
  });

  it('snapshot idéntico no cambia el estado', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Synth', 'midi');
    sembrarPlugins(tienda, trackId);
    const antes = tienda.obtenerEstado().project;
    await ok(tienda, 'track.snapshotPluginState', { trackId, pluginInstanceId: 'v1', estadoPluginBase64: 'AAAA' });
    expect(tienda.obtenerEstado().project).toBe(antes);
  });

  it('deshacer una edición posterior no revierte el snapshot del plugin', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Synth', 'midi');
    sembrarPlugins(tienda, trackId);
    await ok(tienda, 'track.update', { trackId, datos: { volumen: 0.5 } });
    await ok(tienda, 'track.snapshotPluginState', { trackId, pluginInstanceId: 'v1', estadoPluginBase64: 'ZZZZ' });
    await tienda.executor.undo();
    const t = pistaDe(tienda.obtenerEstado(), trackId);
    expect(t.volumen).not.toBe(0.5);
    expect(t.plugins![0]!.estadoPluginBase64).toBe('ZZZZ');
  });
});

describe('U2 · transporte fuera de la pila', () => {
  it('play/stop/seek/loop/metrónomo/record/punch/count-in no crean entradas de undo', async () => {
    const tienda = nuevaTienda();
    await crearPista(tienda, 'Audio');
    const depth = tienda.executor.getUndoDepth();
    const modificadoAntes = tienda.obtenerEstado().project.modificado;
    for (const type of [
      'transport.toggle',
      'transport.toggleLoop',
      'transport.toggleMetronome',
      'transport.toggleRecord',
      'transport.toggleRecord',
      'transport.togglePunch',
      'transport.toggleCountIn',
      'transport.stop',
    ]) {
      await ok(tienda, type, {});
    }
    await ok(tienda, 'transport.seek', { segundos: 3 });
    await ok(tienda, 'transport.setRecordMode', { modo: 'comping' });
    expect(tienda.executor.getUndoDepth()).toBe(depth);
    expect(tienda.obtenerEstado().project.modificado).toBe(modificadoAntes);
  });

  it('Play + Ctrl+Z no detiene la reproducción (deshace la última edición real)', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Audio');
    await ok(tienda, 'track.update', { trackId, datos: { volumen: 0.3 } });
    await ok(tienda, 'transport.toggle', {});
    expect(tienda.obtenerEstado().transport.reproduciendo).toBe(true);
    const r = await tienda.executor.undo();
    expect(r.success).toBe(true);
    expect(tienda.obtenerEstado().transport.reproduciendo).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), trackId).volumen).not.toBe(0.3);
  });

  it('el transporte no invalida el redo', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Audio');
    await ok(tienda, 'track.update', { trackId, datos: { volumen: 0.3 } });
    await tienda.executor.undo();
    await ok(tienda, 'transport.seek', { segundos: 1 });
    expect(tienda.executor.canRedo()).toBe(true);
  });
});

describe('U2 · coalescencia por gesto', () => {
  it('50 track.update del mismo gesto = 1 undo que vuelve al valor inicial', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Audio');
    const inicial = pistaDe(tienda.obtenerEstado(), trackId).volumen;
    const depth = tienda.executor.getUndoDepth();
    const opciones = { coalesceKey: `track.volumen:${trackId}`, gestureId: 'g1' };
    for (let i = 1; i <= 50; i++) {
      await ok(tienda, 'track.update', { trackId, datos: { volumen: i / 50 } }, opciones);
    }
    expect(tienda.executor.getUndoDepth()).toBe(depth + 1);
    await tienda.executor.undo();
    expect(pistaDe(tienda.obtenerEstado(), trackId).volumen).toBe(inicial);
    await tienda.executor.redo();
    expect(pistaDe(tienda.obtenerEstado(), trackId).volumen).toBe(1);
  });

  it('dos gestos distintos son dos entradas', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Audio');
    const depth = tienda.executor.getUndoDepth();
    await ok(tienda, 'project.setBpm', { bpm: 121 }, { coalesceKey: 'project.bpm', gestureId: 'a' });
    await ok(tienda, 'project.setBpm', { bpm: 122 }, { coalesceKey: 'project.bpm', gestureId: 'a' });
    await ok(tienda, 'project.setBpm', { bpm: 130 }, { coalesceKey: 'project.bpm', gestureId: 'b' });
    expect(tienda.executor.getUndoDepth()).toBe(depth + 2);
    await tienda.executor.undo();
    expect(tienda.obtenerEstado().project.bpm.valor).toBe(122);
    expect(trackId).toBeTruthy();
  });
});

describe('U2 · inversos por instantánea (round-trip)', () => {
  async function roundTrip(tienda: Tienda, type: string, payload: unknown): Promise<void> {
    const antes = comparable(tienda.obtenerEstado());
    const depth = tienda.executor.getUndoDepth();
    await ok(tienda, type, payload);
    const despues = comparable(tienda.obtenerEstado());
    expect(despues, `${type} debe cambiar el proyecto`).not.toEqual(antes);
    expect(tienda.executor.getUndoDepth(), `${type} debe entrar en la pila`).toBe(depth + 1);
    expect((await tienda.executor.undo()).success).toBe(true);
    expect(comparable(tienda.obtenerEstado()), `undo de ${type}`).toEqual(antes);
    expect((await tienda.executor.redo()).success).toBe(true);
    expect(comparable(tienda.obtenerEstado()), `redo de ${type}`).toEqual(despues);
  }

  it('proyecto, compás, master y marcadores', async () => {
    const tienda = nuevaTienda();
    await roundTrip(tienda, 'project.update', { datos: { nombre: 'Otro nombre', sampleRate: 48000 } });
    await roundTrip(tienda, 'project.setTimeSignature', { numerador: 7, denominador: 8 });
    await roundTrip(tienda, 'master.update', { datos: { volumen: 0.7, paneo: 0.2 } });
    await roundTrip(tienda, 'marker.create', { tiempo: 8, nombre: 'Coro' });
  });

  it('automatización', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Audio');
    await roundTrip(tienda, 'automation.setCurve', {
      trackId,
      parametro: 'volumen',
      puntos: [
        { tiempo: 0, valor: 0.2 },
        { tiempo: 4, valor: 0.9 },
      ],
    });
    await roundTrip(tienda, 'automation.writePoint', { trackId, parametro: 'volumen', tiempo: 2, valor: 0.5 });
    await roundTrip(tienda, 'automation.clear', { trackId, parametro: 'volumen' });
  });

  it('tomas y comping', async () => {
    const tienda = nuevaTienda();
    const pistaId = await crearPista(tienda, 'Voz');
    await ok(tienda, 'take.folder.ensure', { pistaId });
    const add = await ok(tienda, 'take.add', { pistaId, archivo: 'C:/rec/t1.wav', inicioGrabacion: 0, finGrabacion: 4 });
    const takeId = (add.result as { takeId: string }).takeId;
    await roundTrip(tienda, 'comp.segment.set', { pistaId, takeId, timelineInicio: 0, timelineFin: 4, segmentId: 'seg-1' });
    await roundTrip(tienda, 'comp.segment.clear', { segmentId: 'seg-1' });
    await roundTrip(tienda, 'take.delete', { takeId });
  });

  it('routing: bus, envío y sidechain', async () => {
    const tienda = nuevaTienda();
    const a = await crearPista(tienda, 'Bombo');
    const b = await crearPista(tienda, 'Bajo');
    await roundTrip(tienda, 'bus.create', { nombre: 'Reverb' });
    const r = await ok(tienda, 'bus.create', { nombre: 'Delay' });
    const busId = (r.result as { busId: string }).busId;
    await roundTrip(tienda, 'send.set', { trackId: a, busId, amount: 0.4 });
    await roundTrip(tienda, 'sidechain.connect', { origenTrackId: a, destinoTrackId: b });
  });

  it('congelar y descongelar pista', async () => {
    const tienda = nuevaTienda();
    const trackId = await crearPista(tienda, 'Synth', 'midi');
    await roundTrip(tienda, 'track.freeze', { trackId, audioPath: 'C:/freeze/x.wav' });
    await ok(tienda, 'track.freeze', { trackId, audioPath: 'C:/freeze/x.wav' });
    await roundTrip(tienda, 'track.unfreeze', { trackId });
  });
});

describe('U2 · lotes y clipInicio', () => {
  it('borrar varios clips en un batch = 1 undo', async () => {
    const tienda = nuevaTienda();
    const pistaId = await crearPista(tienda, 'Audio');
    for (const id of ['c1', 'c2', 'c3']) {
      await ok(tienda, 'clip.create', { pistaId, id, inicio: 0, duracion: 2 });
    }
    const depth = tienda.executor.getUndoDepth();
    const r = await tienda.executor.batch(
      ['c1', 'c2', 'c3'].map((clipId) => ({ type: 'clip.delete', payload: { pistaId, clipId } })),
    );
    expect(r.success).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), pistaId).clips).toHaveLength(0);
    expect(tienda.executor.getUndoDepth()).toBe(depth + 1);
    await tienda.executor.undo();
    expect(pistaDe(tienda.obtenerEstado(), pistaId).clips.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('clip.create conserva clipInicio (copiar/pegar/duplicar)', async () => {
    const tienda = nuevaTienda();
    const pistaId = await crearPista(tienda, 'Audio');
    await ok(tienda, 'clip.create', { pistaId, id: 'c1', inicio: 4, duracion: 2, sourceId: 'a.wav', clipInicio: 1.5 });
    const clip = pistaDe(tienda.obtenerEstado(), pistaId).clips[0] as unknown as { clipInicio: number; source: { duracion: number } };
    expect(clip.clipInicio).toBe(1.5);
    expect(clip.source.duracion).toBeGreaterThanOrEqual(3.5);
    // Sin clipInicio sigue empezando en 0; negativos se rechazan por esquema.
    await ok(tienda, 'clip.create', { pistaId, id: 'c2', inicio: 8, duracion: 2 });
    expect((pistaDe(tienda.obtenerEstado(), pistaId).clips[1] as unknown as { clipInicio: number }).clipInicio).toBe(0);
    const neg = await tienda.executor.execute('clip.create', { pistaId, inicio: 0, duracion: 1, clipInicio: -1 });
    expect(neg.success).toBe(false);
  });
});

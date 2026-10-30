import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { FileServiceMemoria, guardarProyecto } from '../project/persistencia';
import type { DAWState } from '../types/state';
import type { Track } from '../types/tracks';

const nuevaTienda = () => crearTiendaDAW({ estadoInicial: crearEstadoInicial() });

async function crearPistaAudio(tienda: ReturnType<typeof nuevaTienda>, nombre = 'Audio'): Promise<string> {
  const r = await tienda.executor.execute('track.create', { nombre, tipo: 'audio' });
  expect(r.success).toBe(true);
  return (r.result as { trackId: string }).trackId;
}

async function crearPistaMidi(tienda: ReturnType<typeof nuevaTienda>, nombre = 'MIDI'): Promise<string> {
  const r = await tienda.executor.execute('track.create', { nombre, tipo: 'midi' });
  expect(r.success).toBe(true);
  return (r.result as { trackId: string }).trackId;
}

const pistaDe = (state: DAWState, id: string): Track => state.project.tracks.find((t) => t.id === id)!;

describe('Validación de dominio: BPM y compás', () => {
  it('rechaza BPM 0 y NaN sin tocar el proyecto', async () => {
    const tienda = nuevaTienda();
    const antes = tienda.obtenerEstado().project;

    for (const bpm of [0, Number.NaN, Infinity, 19, 301]) {
      const r = await tienda.executor.execute('project.setBpm', { bpm });
      expect(r.success).toBe(false);
      expect(r.error?.code).toBe('VALIDATION_FAILED');
    }
    expect(tienda.obtenerEstado().project).toBe(antes);
  });

  it('acepta BPM dentro de rango', async () => {
    const tienda = nuevaTienda();
    const r = await tienda.executor.execute('project.setBpm', { bpm: 90 });
    expect(r.success).toBe(true);
    expect(tienda.obtenerEstado().project.bpm.valor).toBe(90);
  });

  it('rechaza compases con denominador no potencia de 2', async () => {
    const tienda = nuevaTienda();
    for (const denominador of [3, 5, 7, 0, 64]) {
      const r = await tienda.executor.execute('project.setTimeSignature', { numerador: 4, denominador });
      expect(r.success, `denominador ${denominador}`).toBe(false);
    }
    expect(tienda.obtenerEstado().project.timeSignature.denominador).toBe(4);
  });

  it('acepta 7/8 y rechaza numeradores fuera de 1..32 o fraccionarios', async () => {
    const tienda = nuevaTienda();
    const ok = await tienda.executor.execute('project.setTimeSignature', { numerador: 7, denominador: 8 });
    expect(ok.success).toBe(true);
    expect(tienda.obtenerEstado().project.timeSignature.numerador).toBe(7);

    for (const numerador of [0, 33, 4.5]) {
      const r = await tienda.executor.execute('project.setTimeSignature', { numerador, denominador: 4 });
      expect(r.success, `numerador ${numerador}`).toBe(false);
    }
  });

  it('project.update valida BPM y compás anidados', async () => {
    const tienda = nuevaTienda();
    const bpm = await tienda.executor.execute('project.update', { datos: { bpm: { valor: 0, tipo: 'fijo' } } });
    expect(bpm.success).toBe(false);

    const compas = await tienda.executor.execute('project.update', { datos: { timeSignature: { numerador: 4, denominador: 3 } } });
    expect(compas.success).toBe(false);

    const valido = await tienda.executor.execute('project.update', {
      datos: { bpm: { valor: 110, tipo: 'fijo' }, timeSignature: { numerador: 6, denominador: 8 } },
    });
    expect(valido.success).toBe(true);
  });
});

describe('Validación de dominio: pistas', () => {
  it('rechaza nombres vacíos o demasiado largos', async () => {
    const tienda = nuevaTienda();
    const id = await crearPistaAudio(tienda);

    const vacio = await tienda.executor.execute('track.update', { trackId: id, datos: { nombre: '   ' } });
    expect(vacio.success).toBe(false);

    const largo = await tienda.executor.execute('track.update', { trackId: id, datos: { nombre: 'x'.repeat(65) } });
    expect(largo.success).toBe(false);
    expect(pistaDe(tienda.obtenerEstado(), id).nombre).toBe('Audio');
  });

  it('renombra con sufijo automático cuando el nombre ya existe', async () => {
    const tienda = nuevaTienda();
    const a = await crearPistaAudio(tienda, 'Voz');
    const b = await crearPistaAudio(tienda, 'Voz');
    expect(pistaDe(tienda.obtenerEstado(), a).nombre).toBe('Voz');
    expect(pistaDe(tienda.obtenerEstado(), b).nombre).toBe('Voz (2)');

    const c = await tienda.executor.execute('track.update', { trackId: b, datos: { nombre: 'Voz' } });
    expect(c.success).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), b).nombre).toBe('Voz (2)');
  });

  it('no permite cambiar id ni tipo por track.update', async () => {
    const tienda = nuevaTienda();
    const id = await crearPistaAudio(tienda);
    const antes = pistaDe(tienda.obtenerEstado(), id);

    const cambioId = await tienda.executor.execute('track.update', { trackId: id, datos: { id: 'otro' } });
    expect(cambioId.success).toBe(false);

    const cambioTipo = await tienda.executor.execute('track.update', { trackId: id, datos: { tipo: 'midi' } });
    expect(cambioTipo.success).toBe(false);

    expect(pistaDe(tienda.obtenerEstado(), id)).toBe(antes);
  });

  it('valida volumen lineal [0, 4] y paneo [-1, 1]', async () => {
    const tienda = nuevaTienda();
    const id = await crearPistaAudio(tienda);
    const antes = pistaDe(tienda.obtenerEstado(), id);

    for (const volumen of [-0.01, 4.1, Number.NaN, Infinity]) {
      const r = await tienda.executor.execute('track.update', { trackId: id, datos: { volumen } });
      expect(r.success, `volumen ${String(volumen)}`).toBe(false);
    }
    for (const paneo of [-1.1, 1.1, Number.NaN]) {
      const r = await tienda.executor.execute('track.update', { trackId: id, datos: { paneo } });
      expect(r.success, `paneo ${String(paneo)}`).toBe(false);
    }

    const ok = await tienda.executor.execute('track.update', { trackId: id, datos: { volumen: 1.5, paneo: -0.5 } });
    expect(ok.success).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), id)).not.toBe(antes);
  });

  it('valida volumen y paneo del master', async () => {
    const tienda = nuevaTienda();
    for (const datos of [{ volumen: -1 }, { volumen: 5 }, { paneo: 2 }, { volumen: Number.NaN }]) {
      const r = await tienda.executor.execute('master.update', { datos });
      expect(r.success, JSON.stringify(datos)).toBe(false);
    }
    const ok = await tienda.executor.execute('master.update', { datos: { volumen: 1, paneo: 0 } });
    expect(ok.success).toBe(true);
  });
});

describe('Validación de dominio: clips', () => {
  it('rechaza inicio negativo, duración 0 y NaN al crear clips', async () => {
    const tienda = nuevaTienda();
    const id = await crearPistaAudio(tienda);
    for (const payload of [
      { pistaId: id, inicio: -1, duracion: 2 },
      { pistaId: id, inicio: 0, duracion: 0 },
      { pistaId: id, inicio: 0, duracion: Number.NaN },
    ]) {
      const r = await tienda.executor.execute('clip.create', payload);
      expect(r.success, JSON.stringify(payload)).toBe(false);
    }
    expect(pistaDe(tienda.obtenerEstado(), id).clips).toHaveLength(0);
  });

  it('no crea clips de audio en pistas no compatibles', async () => {
    const tienda = nuevaTienda();
    const midi = await crearPistaMidi(tienda);
    const bus = await tienda.executor.execute('track.create', { nombre: 'Bus', tipo: 'bus' });
    const busId = (bus.result as { trackId: string }).trackId;

    const enMidi = await tienda.executor.execute('clip.create', { pistaId: midi, inicio: 0, duracion: 1 });
    expect(enMidi.success).toBe(false);

    const enBus = await tienda.executor.execute('clip.create', { pistaId: busId, inicio: 0, duracion: 1 });
    expect(enBus.success).toBe(false);
  });

  it('un clip MIDI no puede moverse a una pista de bus', async () => {
    const tienda = nuevaTienda();
    const midi = await crearPistaMidi(tienda);
    const bus = await tienda.executor.execute('track.create', { nombre: 'Bus', tipo: 'bus' });
    const busId = (bus.result as { trackId: string }).trackId;

    const creado = await tienda.executor.execute('midi.clip.create', {
      pistaId: midi,
      inicio: 0,
      duracion: 2,
      notas: [{ pitch: 60, inicio: 0, duracion: 1 }],
    });
    expect(creado.success).toBe(true);
    const clipId = (creado.result as { clipId: string }).clipId;

    const mover = await tienda.executor.execute('clip.move', {
      pistaId: midi,
      clipId,
      inicio: 0,
      pistaDestinoId: busId,
    });
    expect(mover.success).toBe(false);
  });
});

describe('Validación al guardar', () => {
  it('no escribe ni rota el .bak si el proyecto es inválido', async () => {
    const fileService = new FileServiceMemoria();
    const ruta = 'C:/tmp/valido.jaswave';
    await fileService.guardar(`${ruta}.bak`, 'respaldo bueno');

    const invalido = crearEstadoInicial();
    invalido.project = {
      ...invalido.project,
      bpm: { ...invalido.project.bpm, valor: null as unknown as number },
    };

    await expect(guardarProyecto(invalido.project, ruta, fileService)).rejects.toThrow(/No se guardó el proyecto/);
    expect(await fileService.existe(ruta)).toBe(false);
    expect(await fileService.leer(`${ruta}.bak`)).toBe('respaldo bueno');
  });

  it('guarda un proyecto válido', async () => {
    const fileService = new FileServiceMemoria();
    const ruta = 'C:/tmp/valido.jaswave';
    const estado = crearEstadoInicial();
    await guardarProyecto(estado.project, ruta, fileService);
    expect(await fileService.existe(ruta)).toBe(true);
  });
});

describe('Validación de dominio: carpetas-bus (padreId)', () => {
  async function crearCarpeta(tienda: ReturnType<typeof nuevaTienda>, nombre: string): Promise<string> {
    const r = await tienda.executor.execute('track.create', { nombre, tipo: 'carpeta' });
    expect(r.success).toBe(true);
    return (r.result as { trackId: string }).trackId;
  }

  it('mete una pista en una carpeta, la saca y lo deshace', async () => {
    const tienda = nuevaTienda();
    const carpeta = await crearCarpeta(tienda, 'Cuerdas');
    const pista = await crearPistaMidi(tienda, 'Violín');
    const r = await tienda.executor.execute('track.update', { trackId: pista, datos: { padreId: carpeta } });
    expect(r.success).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), pista).padreId).toBe(carpeta);
    const fuera = await tienda.executor.execute('track.update', { trackId: pista, datos: { padreId: null } });
    expect(fuera.success).toBe(true);
    expect(pistaDe(tienda.obtenerEstado(), pista).padreId ?? null).toBeNull();
  });

  it('rechaza un padre que no es carpeta, inexistente o que crea un ciclo', async () => {
    const tienda = nuevaTienda();
    const a = await crearCarpeta(tienda, 'A');
    const b = await crearCarpeta(tienda, 'B');
    const midi = await crearPistaMidi(tienda, 'Piano');
    expect((await tienda.executor.execute('track.update', { trackId: b, datos: { padreId: a } })).success).toBe(true);
    for (const [trackId, padreId] of [
      [midi, midi],
      [a, b],
      [a, a],
      [midi, 'no-existe'],
      [b, midi],
    ] as const) {
      const r = await tienda.executor.execute('track.update', { trackId, datos: { padreId } });
      expect(r.success, `${trackId} → ${padreId}`).toBe(false);
    }
  });
});

/**
 * Tests WS-4f — carga robusta de proyectos `.jaswave`:
 * esquema zod, migraciones de formato, JSON dañado y respaldo `.bak`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { crearTiendaDAW, crearEstadoInicial } from '../state';
import { crearRegistroComandos } from '../state/registro-comandos';
import { registrarComandosBuiltin } from '../state/comandos-builtin';
import { CommandExecutor } from '../state/ejecutor-comandos';
import { crearPilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import { crearRegistroAuditoria } from '../state/registro-auditoria';
import { BusEventosMemoria } from '../events/event-bus';
import { EventosProyecto } from '../constants/nombres-eventos';
import { configurarFileService } from '../commands/project-commands';
import {
  proyectoNuevo,
  proyectoParaGuardar,
  FORMATO_ACTUAL,
  guardarProyecto,
  cargarProyecto,
  cargarProyectoConRespaldo,
  ErrorCargaProyecto,
  FileServiceMemoria,
  migrarArchivo,
  validarProyectoArchivo,
  validarProyecto,
} from '../project';
import type { MigracionArchivo } from '../project';
import type { PluginInfo } from '../types/entidades';
import type { ProjectState } from '../types/proyecto';

const plugin = (id: string): PluginInfo => ({
  id,
  nombre: 'EQ',
  fabricante: 'JasWave',
  tipo: 'efecto',
  bypass: false,
  parametros: [],
  estado: 'cargado',
  version: '1.0.0',
  wet: 1,
  latencia: 0,
  categoria: 'efecto',
  autor: 'JasWave',
  licencia: 'interno',
  descripcion: 'test',
  ui: { ancho: 320, alto: 180, personalizable: false },
});

/** Proyecto real producido por comandos (pistas, clips audio/MIDI, plugins). */
async function proyectoConContenido(): Promise<ProjectState> {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
  const ok = async (tipo: string, payload: unknown) => {
    const r = await tienda.executor.execute(tipo, payload);
    expect(r.success, `${tipo}: ${r.error?.message}`).toBe(true);
    return r;
  };
  const audio = await ok('track.create', { nombre: 'Voz', tipo: 'audio' });
  const audioId = (audio.result as { trackId: string }).trackId;
  const midi = await ok('track.create', { nombre: 'Piano', tipo: 'midi' });
  const midiId = (midi.result as { trackId: string }).trackId;
  await ok('clip.create', { pistaId: audioId, inicio: 0, duracion: 4 });
  await ok('midi.clip.create', {
    pistaId: midiId,
    nombre: 'Frase',
    notas: [
      { pitch: 60, inicio: 0, duracion: 1, velocidad: 90 },
      { pitch: 64, inicio: 1, duracion: 1, velocidad: 80 },
    ],
  });
  await ok('plugin.insert', { trackId: midiId, plugin: plugin('plugin-eq-1'), position: 0 });
  const proyecto = tienda.obtenerEstado().project;
  expect(proyecto.tracks.length).toBeGreaterThanOrEqual(2);
  return proyecto;
}

const archivoJson = (proyecto: ProjectState) => JSON.parse(JSON.stringify(proyectoParaGuardar(proyecto)));

describe('esquema de ProyectoArchivo', () => {
  it('acepta el proyecto inicial (crearEstadoInicial y proyectoNuevo)', () => {
    expect(validarProyectoArchivo(archivoJson(crearEstadoInicial().project)).ok).toBe(true);
    expect(validarProyectoArchivo(archivoJson(proyectoNuevo('Nuevo'))).ok).toBe(true);
  });

  it('acepta proyectos tras track/clip/midi.clip/plugin', async () => {
    const r = validarProyectoArchivo(archivoJson(await proyectoConContenido()));
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  it('rechaza bpm como texto sin coercionar', () => {
    const a = archivoJson(proyectoNuevo('X'));
    a.project.bpm.valor = '120';
    const r = validarProyectoArchivo(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('project.bpm.valor: se esperaba número, se recibió texto');
  });

  it('rechaza tracks que no son array', () => {
    const a = archivoJson(proyectoNuevo('X'));
    a.project.tracks = { 0: 'x' };
    const r = validarProyectoArchivo(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('project.tracks: se esperaba array, se recibió objeto');
  });

  it('informa la ruta de clips con tiempos no numéricos', async () => {
    const a = archivoJson(await proyectoConContenido());
    const conClip = a.project.tracks.findIndex((t: { clips: unknown[] }) => t.clips.length > 0);
    a.project.tracks[conClip].clips[0].inicio = 'cero';
    const r = validarProyectoArchivo(a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`project.tracks[${conClip}].clips[0].inicio`);
  });

  it('limita el mensaje a los primeros 5 problemas', () => {
    const a = archivoJson(proyectoNuevo('X'));
    Object.assign(a.project, { id: 1, nombre: 2, sampleRate: 'a', bitDepth: 'b', bpm: 3, timeSignature: 4, master: 5 });
    const r = validarProyectoArchivo(a);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas.length).toBe(7);
      expect(r.error).toContain('(y 2 problemas más)');
    }
  });

  it('passthrough conserva campos desconocidos', () => {
    const a = archivoJson(proyectoNuevo('X'));
    a.extraArchivo = { futuro: true };
    a.project.campoNuevo = 'hola';
    a.project.tracks = [{ id: 't1', nombre: 'T', tipo: 'audio', clips: [{ id: 'c1', tipo: 'audio', inicio: 0, duracion: 1, rareza: 7 }], plugins: [] }];
    const r = validarProyectoArchivo(a);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((r.datos as Record<string, unknown>).extraArchivo).toEqual({ futuro: true });
      expect((r.datos.project as Record<string, unknown>).campoNuevo).toBe('hola');
      expect((r.datos.project.tracks[0]!.clips![0] as Record<string, unknown>).rareza).toBe(7);
    }
  });

  it('validarProyecto valida solo el ProjectState', () => {
    expect(validarProyecto(crearEstadoInicial().project).ok).toBe(true);
    const r = validarProyecto({ id: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('project.nombre');
  });
});

describe('migraciones de formato de archivo', () => {
  const migracion0a1: MigracionArchivo = {
    desde: 0,
    hacia: 1,
    descripcion: 'v0 guardaba el proyecto en "proyecto" y sin audioReferences',
    migrar: (archivo) => {
      const { proyecto, ...resto } = archivo as Record<string, unknown> & { version: number };
      return { ...resto, version: 1, project: proyecto, audioReferences: {} };
    },
  };

  it('el formato actual no requiere migraciones', () => {
    const r = migrarArchivo(archivoJson(proyectoNuevo('X')));
    expect(r.versionOriginal).toBe(FORMATO_ACTUAL);
    expect(r.migracionesAplicadas).toEqual([]);
  });

  it('rechaza una versión futura pidiendo actualizar JasWave', () => {
    expect(() => migrarArchivo({ version: FORMATO_ACTUAL + 1 })).toThrow(/Actualiza JasWave/);
  });

  it('rechaza versiones antiguas sin migración registrada', () => {
    expect(() => migrarArchivo({ version: 0 })).toThrow('No hay migración disponible');
  });

  it('aplica una migración inyectada 0→1 al cargar', async () => {
    const fs = new FileServiceMemoria();
    const v0 = { version: 0, proyecto: proyectoNuevo('Antiguo') };
    await fs.guardar('antiguo.jaswave', JSON.stringify(v0));
    await expect(cargarProyecto('antiguo.jaswave', fs)).rejects.toThrow('No hay migración disponible');
    const cargado = await cargarProyecto('antiguo.jaswave', fs, { migraciones: [migracion0a1] });
    expect(cargado.nombre).toBe('Antiguo');
    expect(cargado.ruta).toBe('antiguo.jaswave');
  });
});

describe('cargarProyecto robusto', () => {
  let fs: FileServiceMemoria;
  beforeEach(() => {
    fs = new FileServiceMemoria();
  });

  it('round-trip de un proyecto con contenido', async () => {
    const proyecto = await proyectoConContenido();
    await guardarProyecto(proyecto, 'lleno.jaswave', fs);
    const cargado = await cargarProyecto('lleno.jaswave', fs);
    expect(cargado.tracks.map((t) => t.nombre)).toEqual(proyecto.tracks.map((t) => t.nombre));
    expect(cargado.tracks.flatMap((t) => t.clips).length).toBe(proyecto.tracks.flatMap((t) => t.clips).length);
  });

  it('JSON dañado → mensaje amigable sin respaldo', async () => {
    await fs.guardar('roto.jaswave', '{"version":1,"project":{');
    const err = await cargarProyecto('roto.jaswave', fs).catch((e) => e);
    expect(err).toBeInstanceOf(ErrorCargaProyecto);
    expect(err.message).toBe('El archivo no es un proyecto JasWave válido (JSON dañado)');
    expect(err.codigo).toBe('json');
    expect(err.hayRespaldo).toBe(false);
  });

  it('JSON dañado con .bak → el mensaje menciona la copia de seguridad', async () => {
    await fs.guardar('roto.jaswave', 'basura');
    await fs.guardar('roto.jaswave.bak', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Bueno'))));
    const err = await cargarProyecto('roto.jaswave', fs).catch((e) => e);
    expect(err.message).toContain('JSON dañado');
    expect(err.message).toContain('copia de seguridad (roto.jaswave.bak)');
    expect(err.hayRespaldo).toBe(true);
  });

  it('campos faltantes → error con ruta', async () => {
    const a = archivoJson(proyectoNuevo('X'));
    delete a.project.master;
    await fs.guardar('sin-master.jaswave', JSON.stringify(a));
    await expect(cargarProyecto('sin-master.jaswave', fs)).rejects.toThrow('project.master: falta el campo');
  });

  it('versión futura → pide actualizar JasWave', async () => {
    await fs.guardar('futuro.jaswave', JSON.stringify({ ...archivoJson(proyectoNuevo('X')), version: FORMATO_ACTUAL + 5 }));
    const err = await cargarProyecto('futuro.jaswave', fs).catch((e) => e);
    expect(err.codigo).toBe('version');
    expect(err.message).toContain('Actualiza JasWave');
  });
});

describe('cargarProyectoConRespaldo', () => {
  let fs: FileServiceMemoria;
  beforeEach(() => {
    fs = new FileServiceMemoria();
  });

  it('sin daño no usa el respaldo', async () => {
    await guardarProyecto(proyectoNuevo('Sano'), 'sano.jaswave', fs);
    const r = await cargarProyectoConRespaldo('sano.jaswave', fs);
    expect(r.usadoRespaldo).toBe(false);
    expect(r.proyecto.nombre).toBe('Sano');
  });

  it('archivo dañado → carga el .bak y marca modificado', async () => {
    await fs.guardar('p.jaswave', '{ dañado');
    await fs.guardar('p.jaswave.bak', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Respaldo'))));
    const r = await cargarProyectoConRespaldo('p.jaswave', fs);
    expect(r.usadoRespaldo).toBe(true);
    expect(r.proyecto.nombre).toBe('Respaldo');
    expect(r.proyecto.ruta).toBe('p.jaswave');
    expect(r.proyecto.modificado).toBe(true);
    expect(r.errorOriginal).toContain('JSON dañado');
  });

  it('estructura inválida → también recupera del .bak', async () => {
    const a = archivoJson(proyectoNuevo('X'));
    a.project.tracks = 'nada';
    await fs.guardar('p.jaswave', JSON.stringify(a));
    await fs.guardar('p.jaswave.bak', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Respaldo'))));
    const r = await cargarProyectoConRespaldo('p.jaswave', fs);
    expect(r.usadoRespaldo).toBe(true);
  });

  it('archivo y .bak dañados → error que menciona ambos', async () => {
    await fs.guardar('p.jaswave', 'x');
    await fs.guardar('p.jaswave.bak', 'y');
    await expect(cargarProyectoConRespaldo('p.jaswave', fs)).rejects.toThrow(/JSON dañado.*tampoco se pudo cargar/);
  });

  it('versión futura no se recupera del .bak', async () => {
    await fs.guardar('p.jaswave', JSON.stringify({ ...archivoJson(proyectoNuevo('X')), version: FORMATO_ACTUAL + 1 }));
    await fs.guardar('p.jaswave.bak', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Respaldo'))));
    await expect(cargarProyectoConRespaldo('p.jaswave', fs)).rejects.toThrow('Actualiza JasWave');
  });
});

describe('project.load con respaldo', () => {
  it('emite proyecto.recuperadoDeRespaldo cuando usa el .bak', async () => {
    const fs = new FileServiceMemoria();
    configurarFileService(fs);
    await fs.guardar('C:/tmp/cancion.jaswave', '{ roto');
    await fs.guardar('C:/tmp/cancion.jaswave.bak', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Cancion'))));

    const registro = crearRegistroComandos();
    registrarComandosBuiltin(registro);
    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    const r = await executor.execute('project.load', { ruta: 'C:/tmp/cancion.jaswave' });
    expect(r.success).toBe(true);
    expect(r.result).toEqual({ ruta: 'C:/tmp/cancion.jaswave', usadoRespaldo: true });
    expect(r.events.map((e) => e.nombre)).toContain(EventosProyecto.recuperadoDeRespaldo);
    const proyecto = executor.obtenerEstado().project;
    expect(proyecto.nombre).toBe('Cancion');
    expect(proyecto.modificado).toBe(true);

    await fs.guardar('C:/tmp/sano.jaswave', JSON.stringify(proyectoParaGuardar(proyectoNuevo('Sano'))));
    const r2 = await executor.execute('project.load', { ruta: 'C:/tmp/sano.jaswave' });
    expect(r2.success).toBe(true);
    expect(r2.events.map((e) => e.nombre)).not.toContain(EventosProyecto.recuperadoDeRespaldo);
    expect(executor.obtenerEstado().project.modificado).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  proyectoNuevo,
  validarNombre,
  validarExtensionRuta,
  proyectoParaGuardar,
  archivoValido,
  FORMATO_ACTUAL,
  validarIntegridadProyecto,
  reconstruirRouting,
  verificarReferenciasAudio,
  esNombreSinTitulo,
  nombreDesdeRuta,
  nombreAlGuardar,
} from '../project/ciclo-vida';
import { guardarProyecto, cargarProyecto, FileServiceMemoria } from '../project/persistencia';
import type { ProjectState } from '../types/proyecto';
import type { AudioReference } from '../project/ciclo-vida';

describe('proyectoNuevo', () => {
  it('deberia crear un proyecto con valores por defecto', () => {
    const proyecto = proyectoNuevo('Demo');
    expect(proyecto.nombre).toBe('Demo');
    expect(proyecto.sampleRate).toBe(48000);
    expect(proyecto.bitDepth).toBe(24);
    expect(proyecto.bpm.valor).toBe(120);
    expect(proyecto.timeSignature.numerador).toBe(4);
    expect(proyecto.timeSignature.denominador).toBe(4);
    expect(proyecto.tracks).toHaveLength(0);
    expect(proyecto.metadata.readOnly).toBe(false);
  });

  it('deberia usar Untitled si el nombre esta vacio', () => {
    const proyecto = proyectoNuevo('');
    expect(proyecto.nombre).toBe('Untitled');
  });

  it('deberia generar ids unicos', () => {
    const p1 = proyectoNuevo('A');
    const p2 = proyectoNuevo('B');
    expect(p1.id).not.toBe(p2.id);
  });
});

describe('validarNombre', () => {
  it('deberia aceptar nombres validos', () => {
    expect(() => validarNombre('Proyecto')).not.toThrow();
  });

  it('deberia rechazar nombres vacios', () => {
    expect(() => validarNombre('')).toThrow('El nombre del proyecto no puede estar vacío');
  });

  it('deberia rechazar nombres con solo espacios', () => {
    expect(() => validarNombre('   ')).toThrow('El nombre del proyecto no puede estar vacío');
  });
});

describe('validarExtensionRuta', () => {
  it('deberia aceptar rutas .jaswave', () => {
    expect(() => validarExtensionRuta('proyecto.jaswave')).not.toThrow();
  });

  it('deberia aceptar rutas con mayusculas', () => {
    expect(() => validarExtensionRuta('proyecto.JASWAVE')).not.toThrow();
  });

  it('deberia rechazar extensiones diferentes', () => {
    expect(() => validarExtensionRuta('proyecto.json')).toThrow('Solo se permiten archivos con extensión .jaswave');
  });
});

describe('proyectoParaGuardar', () => {
  it('deberia empaquetar el proyecto con version y audioReferences', () => {
    const proyecto = proyectoNuevo('Test');
    const archivo = proyectoParaGuardar(proyecto);
    expect(archivo.version).toBe(FORMATO_ACTUAL);
    expect(archivo.project).toBe(proyecto);
    expect(archivo.audioReferences).toEqual({});
  });
});

describe('archivoValido', () => {
  it('deberia aceptar un ProyectoArchivo valido', () => {
    const archivo = { version: FORMATO_ACTUAL, project: proyectoNuevo('X'), audioReferences: {} };
    expect(archivoValido(archivo)).toBe(true);
  });

  it('deberia rechazar null', () => {
    expect(archivoValido(null)).toBe(false);
  });

  it('deberia rechazar version incorrecta', () => {
    const archivo = { version: 99, project: proyectoNuevo('X'), audioReferences: {} };
    expect(archivoValido(archivo)).toBe(false);
  });

  it('deberia rechazar sin project', () => {
    const archivo = { version: FORMATO_ACTUAL, audioReferences: {} };
    expect(archivoValido(archivo)).toBe(false);
  });
});

describe('validarIntegridadProyecto', () => {
  it('deberia aceptar un proyecto valido', () => {
    const proyecto = proyectoNuevo('Valid');
    expect(() => validarIntegridadProyecto(proyecto)).not.toThrow();
  });

  it('deberia rechazar proyecto sin id', () => {
    expect(() => validarIntegridadProyecto({ ...proyectoNuevo('X'), id: '' })).toThrow('falta project.id');
  });

  it('deberia rechazar proyecto sin nombre', () => {
    expect(() => validarIntegridadProyecto({ ...proyectoNuevo('X'), nombre: null as any })).toThrow('falta project.nombre');
  });

  it('deberia rechazar sampleRate invalido', () => {
    expect(() => validarIntegridadProyecto({ ...proyectoNuevo('X'), sampleRate: 0 })).toThrow('sampleRate inválido');
  });

  it('deberia rechazar bitDepth invalido', () => {
    expect(() => validarIntegridadProyecto({ ...proyectoNuevo('X'), bitDepth: -1 })).toThrow('bitDepth inválido');
  });

  it('deberia rechazar routing faltante', () => {
    const p = proyectoNuevo('X') as any;
    delete p.routing;
    expect(() => validarIntegridadProyecto(p)).toThrow('routing faltante');
  });

  it('deberia rechazar campos de routing no-arrays', () => {
    const p = proyectoNuevo('X') as any;
    p.routing.buses = 'no-es-array';
    expect(() => validarIntegridadProyecto(p)).toThrow('routing.buses debe ser un array');
  });
});

describe('reconstruirRouting', () => {
  it('deberia preservar routing valido', () => {
    const proyecto = proyectoNuevo('Test');
    const reconstruido = reconstruirRouting(proyecto);
    expect(reconstruido.routing.buses).toEqual([]);
    expect(reconstruido.routing.sends).toEqual([]);
  });

  it('deberia rellenar arrays faltantes con vacios', () => {
    const proyecto = proyectoNuevo('Test') as any;
    proyecto.routing.buses = undefined;
    const reconstruido = reconstruirRouting(proyecto);
    expect(reconstruido.routing.buses).toEqual([]);
  });
});

describe('verificarReferenciasAudio', () => {
  it('deberia detectar referencias sin ruta', async () => {
    const refs: Record<string, AudioReference> = {
      'a1': { id: 'a1', rutaRelativa: 'media/a.wav', formato: 'wav', sampleRate: 44100, canales: 2, duracion: 1 },
      'a2': { id: 'a2', rutaRelativa: '', formato: 'wav', sampleRate: 44100, canales: 2, duracion: 1 },
    };
    const faltantes = await verificarReferenciasAudio(refs);
    expect(faltantes).toContain('a2');
    expect(faltantes).not.toContain('a1');
  });
});

describe('guardarProyecto / cargarProyecto round-trip', () => {
  let fileService: FileServiceMemoria;

  beforeEach(() => {
    fileService = new FileServiceMemoria();
  });

  it('deberia guardar y cargar produciendo estado identico', async () => {
    const proyecto = proyectoNuevo('RoundTrip');
    const ruta = 'test.jaswave';

    await guardarProyecto(proyecto, ruta, fileService);
    const cargado = await cargarProyecto(ruta, fileService);

    expect(cargado.nombre).toBe(proyecto.nombre);
    expect(cargado.sampleRate).toBe(proyecto.sampleRate);
    expect(cargado.bitDepth).toBe(proyecto.bitDepth);
    expect(cargado.bpm.valor).toBe(proyecto.bpm.valor);
    expect(cargado.timeSignature.numerador).toBe(proyecto.timeSignature.numerador);
    expect(cargado.tracks).toHaveLength(proyecto.tracks.length);
    expect(cargado.routing.buses).toEqual(proyecto.routing.buses);
  });

  it('deberia lanzar error al cargar archivo inexistente', async () => {
    await expect(cargarProyecto('no-existe.jaswave', fileService)).rejects.toThrow('No se pudo leer el archivo .jaswave');
  });

  it('deberia lanzar error al cargar JSON invalido', async () => {
    await fileService.guardar('corrupto.jaswave', '{ no es json');
    await expect(cargarProyecto('corrupto.jaswave', fileService)).rejects.toThrow('JSON inválido');
  });

  it('deberia lanzar error al cargar version incompatible', async () => {
    await fileService.guardar('viejo.jaswave', JSON.stringify({ version: 99, project: proyectoNuevo('X'), audioReferences: {} }));
    await expect(cargarProyecto('viejo.jaswave', fileService)).rejects.toThrow('Versión de formato no soportada');
  });

  it('deberia lanzar error al cargar estructura incorrecta', async () => {
    await fileService.guardar('malo.jaswave', JSON.stringify({ version: FORMATO_ACTUAL }));
    await expect(cargarProyecto('malo.jaswave', fileService)).rejects.toThrow('estructura incorrecta');
  });

  it('deberia lanzar error al cargar proyecto corrupto (falta id)', async () => {
    const proyecto = proyectoNuevo('X') as any;
    delete proyecto.id;
    await fileService.guardar('sin-id.jaswave', JSON.stringify({ version: FORMATO_ACTUAL, project: proyecto, audioReferences: {} }));
    await expect(cargarProyecto('sin-id.jaswave', fileService)).rejects.toThrow('falta project.id');
  });

  it('deberia lanzar error al cargar proyecto con sampleRate invalido', async () => {
    const proyecto = proyectoNuevo('X') as any;
    proyecto.sampleRate = 0;
    await fileService.guardar('bad-sr.jaswave', JSON.stringify({ version: FORMATO_ACTUAL, project: proyecto, audioReferences: {} }));
    await expect(cargarProyecto('bad-sr.jaswave', fileService)).rejects.toThrow('sampleRate inválido');
  });

  it('deberia guardar solo archivos .jaswave', async () => {
    await expect(guardarProyecto(proyectoNuevo('X'), 'test.txt', fileService)).rejects.toThrow('Solo se permiten archivos con extensión .jaswave');
  });

  it('deberia rechazar guardar proyecto null', async () => {
    await expect(guardarProyecto(null as any, 'x.jaswave', fileService)).rejects.toThrow('No hay proyecto para guardar');
  });

  it('deberia validar tamano post-escritura correctamente', async () => {
    const proyecto = proyectoNuevo('ValidacionTamano');
    const ruta = 'validacion-tamano.jaswave';
    await expect(guardarProyecto(proyecto, ruta, fileService)).resolves.toBeUndefined();
    const cargado = await cargarProyecto(ruta, fileService);
    expect(cargado.nombre).toBe('ValidacionTamano');
  });

  it('deberia detectar referencias de audio faltantes al cargar', async () => {
    const proyecto = proyectoNuevo('Refs');
    const archivo = proyectoParaGuardar(proyecto);
    archivo.audioReferences = {
      'a1': { id: 'a1', rutaRelativa: 'media/no-existe.wav', formato: 'wav', sampleRate: 44100, canales: 2, duracion: 1 },
    };
    await fileService.guardar('refs.jaswave', JSON.stringify(archivo));
    const cargado = await cargarProyecto('refs.jaswave', fileService);
    expect(cargado.nombre).toBe('Refs');
  });
});

describe('nombre de proyecto al guardar', () => {
  it('detecta nombres sin título', () => {
    expect(esNombreSinTitulo('Proyecto sin nombre')).toBe(true);
    expect(esNombreSinTitulo('Untitled')).toBe(true);
    expect(esNombreSinTitulo('Sin título')).toBe(true);
    expect(esNombreSinTitulo('Mi canción')).toBe(false);
  });

  it('toma el nombre del archivo cuando el proyecto no tiene título', () => {
    expect(nombreDesdeRuta('C:\\\\Users\\\\me\\\\PSR balada.jaswave')).toBe('PSR balada');
    expect(nombreAlGuardar('Proyecto sin nombre', 'D:/music/Demo.jaswave')).toBe('Demo');
    expect(nombreAlGuardar('Tema original', 'D:/music/otro.jaswave')).toBe('Tema original');
  });
});

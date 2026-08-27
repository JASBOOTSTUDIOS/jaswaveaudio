import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proyectoNuevo, validarNombre, validarExtensionRuta, archivoValido, FORMATO_ACTUAL, guardarProyecto, cargarProyecto, proyectoParaGuardar } from '../project';
import type { ProyectoArchivo } from '../project';
import type { ProjectState } from '../types/proyecto';

const archivos = new Map<string, string>();

const fileService = {
  guardar: vi.fn().mockImplementation(async (ruta: string, contenido: string) => {
    archivos.set(ruta, contenido);
  }),
  leer: vi.fn().mockImplementation(async (ruta: string) => {
    const contenido = archivos.get(ruta);
    if (!contenido) throw new Error(`Archivo no encontrado: ${ruta}`);
    return contenido;
  }),
  obtenerTamano: vi.fn().mockImplementation(async (ruta: string) => {
    const contenido = archivos.get(ruta);
    if (!contenido) return 0;
    return new TextEncoder().encode(contenido).length;
  }),
  existe: vi.fn().mockImplementation(async (ruta: string) => archivos.has(ruta)),
};

describe('Ciclo de vida del proyecto', () => {
  beforeEach(() => {
    archivos.clear();
    vi.clearAllMocks();
  });

  it('crea un proyecto nuevo con valores por defecto', () => {
    const proyecto = proyectoNuevo('Demo');
    expect(proyecto.nombre).toBe('Demo');
    expect(proyecto.sampleRate).toBe(48000);
    expect(proyecto.bitDepth).toBe(24);
    expect(proyecto.bpm.valor).toBe(120);
    expect(proyecto.timeSignature.numerador).toBe(4);
    expect(proyecto.timeSignature.denominador).toBe(4);
    expect(proyecto.tracks).toEqual([]);
    expect(proyecto.modificado).toBe(false);
  });

  it('asigna Untitled cuando el nombre está vacío', () => {
    const proyecto = proyectoNuevo('');
    expect(proyecto.nombre).toBe('Untitled');
  });

  it('rechaza nombres vacíos o compuestos solo por espacios', () => {
    expect(() => validarNombre('')).toThrow('El nombre del proyecto no puede estar vacío');
    expect(() => validarNombre('   ')).toThrow('El nombre del proyecto no puede estar vacío');
  });

  it('acepta nombres válidos', () => {
    expect(() => validarNombre('Mi tema')).not.toThrow();
  });

  it('rechaza rutas sin extensión .jaswave', () => {
    expect(() => validarExtensionRuta('/tmp/proyecto.json')).toThrow('Solo se permiten archivos con extensión .jaswave');
  });

  it('acepta rutas .jaswave', () => {
    expect(() => validarExtensionRuta('/tmp/proyecto.jaswave')).not.toThrow();
  });

  it('serializa y valida un ProyectoArchivo válido', () => {
    const payload: ProyectoArchivo = {
      version: FORMATO_ACTUAL,
      project: proyectoNuevo('Guardado'),
      audioReferences: {},
    };

    expect(archivoValido(payload)).toBe(true);
    expect(payload.project.nombre).toBe('Guardado');
    expect(payload.audioReferences).toEqual({});
  });

  it('rechaza payloads inválidos', () => {
    expect(archivoValido(null)).toBe(false);
    expect(archivoValido({})).toBe(false);
    expect(archivoValido({ version: FORMATO_ACTUAL, project: null, audioReferences: null })).toBe(false);
  });
});

describe('Persistencia del proyecto', () => {
  beforeEach(() => {
    archivos.clear();
    vi.clearAllMocks();
  });

  it('guarda un proyecto en disco y lo recupera igual (round-trip)', async () => {
    const proyecto = proyectoNuevo('Roundtrip');
    proyecto.tracks.push({ id: 'track-1', nombre: 'Audio', tipo: 'audio' } as any);

    await guardarProyecto(proyecto, 'demo.jaswave', fileService);
    expect(fileService.guardar).toHaveBeenCalledOnce();

    const cargado = await cargarProyecto('demo.jaswave', fileService);
    expect(cargado.nombre).toBe('Roundtrip');
    expect(cargado.tracks[0].nombre).toBe('Audio');
  });

  it('rechaza guardar en rutas sin .jaswave', async () => {
    await expect(guardarProyecto(proyectoNuevo('X'), 'demo.json', fileService)).rejects.toThrow();
  });

  it('rechaza cargar archivos corruptos', async () => {
    archivos.set('corrupto.jaswave', 'no-es-json');
    await expect(cargarProyecto('corrupto.jaswave', fileService)).rejects.toThrow('JSON inválido');
  });

  it('rechaza cargar archivos con versión incompatible', async () => {
    const payload = { version: 999, project: proyectoNuevo('X'), audioReferences: {} };
    archivos.set('viejo.jaswave', JSON.stringify(payload));
    await expect(cargarProyecto('viejo.jaswave', fileService)).rejects.toThrow('Versión de formato no soportada');
  });

  it('rechaza cargar archivos con estructura incorrecta', async () => {
    archivos.set('malo.jaswave', JSON.stringify({ version: FORMATO_ACTUAL }));
    await expect(cargarProyecto('malo.jaswave', fileService)).rejects.toThrow('estructura incorrecta');
  });

  it('rechaza cargar proyecto corrupto (falta id)', async () => {
    const proyecto = proyectoNuevo('X') as any;
    delete proyecto.id;
    archivos.set('sin-id.jaswave', JSON.stringify({ version: FORMATO_ACTUAL, project: proyecto, audioReferences: {} }));
    await expect(cargarProyecto('sin-id.jaswave', fileService)).rejects.toThrow('falta project.id');
  });

  it('valida tamaño post-escritura correctamente', async () => {
    const proyecto = proyectoNuevo('ValidacionTamano');
    await expect(guardarProyecto(proyecto, 'validacion-tamano.jaswave', fileService)).resolves.toBeUndefined();
    const cargado = await cargarProyecto('validacion-tamano.jaswave', fileService);
    expect(cargado.nombre).toBe('ValidacionTamano');
  });
});

describe('Metadatos de proyecto', () => {
  it('incluye readOnly y customData', () => {
    const proyecto = proyectoNuevo('Meta');
    expect(proyecto.metadata.readOnly).toBe(false);
    expect(proyecto.metadata.customData).toEqual({});
  });
});

import type { ProjectState } from '../types/proyecto';
import type { AudioReference, ProyectoArchivo } from './ciclo-vida';
import { proyectoParaGuardar, archivoValido, validarExtensionRuta, reconstruirRouting, verificarReferenciasAudio } from './ciclo-vida';
import { migrarArchivo } from './migraciones-archivo';
import { repararNotasMidi } from './reparar-notas';
import type { MigracionArchivo } from './migraciones-archivo';
import { validarProyectoArchivo } from '../schemas/proyecto';

export interface FileService {
  guardar(ruta: string, contenido: string): Promise<void>;
  leer(ruta: string): Promise<string>;
  obtenerTamano(ruta: string): Promise<number>;
  existe(ruta: string): Promise<boolean>;
}

export class FileServiceMemoria implements FileService {
  private archivos: Map<string, string> = new Map();

  async guardar(ruta: string, contenido: string): Promise<void> {
    this.archivos.set(ruta, contenido);
  }

  async leer(ruta: string): Promise<string> {
    const contenido = this.archivos.get(ruta);
    if (!contenido) {
      throw new Error(`Archivo no encontrado: ${ruta}`);
    }
    return contenido;
  }

  async existe(ruta: string): Promise<boolean> {
    return this.archivos.has(ruta);
  }

  async eliminar(ruta: string): Promise<void> {
    this.archivos.delete(ruta);
  }

  async obtenerTamano(ruta: string): Promise<number> {
    const contenido = this.archivos.get(ruta);
    if (!contenido) {
      throw new Error(`Archivo no encontrado: ${ruta}`);
    }
    return new TextEncoder().encode(contenido).length;
  }

  limpiar(): void {
    this.archivos.clear();
  }
}

export const guardarProyecto = async (proyecto: ProjectState, ruta: string, fileService: FileService): Promise<void> => {
  validarExtensionRuta(ruta);

  if (!proyecto) {
    throw new Error('No hay proyecto para guardar');
  }

  const payload = proyectoParaGuardar(proyecto);
  const json = JSON.stringify(payload);
  const tamanoEsperado = new TextEncoder().encode(json).length;

  await fileService.guardar(ruta, json);

  try {
    const tamanoReal = await fileService.obtenerTamano(ruta);
    if (tamanoReal !== tamanoEsperado) {
      throw new Error(`Validación post-escritura fallida: se esperaban ${tamanoEsperado} bytes, se escribieron ${tamanoReal} bytes`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('Validación post-escritura')) {
      throw error;
    }
    throw new Error(`No se pudo validar el archivo guardado: ${error instanceof Error ? error.message : 'error desconocido'}`);
  }
};

/** Categoría del fallo de carga (permite decidir si tiene sentido usar el `.bak`). */
export type CodigoErrorCarga = 'lectura' | 'json' | 'version' | 'estructura';

export class ErrorCargaProyecto extends Error {
  readonly codigo: CodigoErrorCarga;
  /** Existe `${ruta}.bak` junto al archivo dañado. */
  readonly hayRespaldo: boolean;

  constructor(mensaje: string, codigo: CodigoErrorCarga, hayRespaldo = false) {
    super(mensaje);
    this.name = 'ErrorCargaProyecto';
    this.codigo = codigo;
    this.hayRespaldo = hayRespaldo;
  }
}

export interface OpcionesCargaProyecto {
  /** Registro de migraciones de formato (inyectable para tests). */
  migraciones?: readonly MigracionArchivo[];
}

/** Ruta de la copia de seguridad que deja la escritura atómica del guardado. */
export const rutaRespaldo = (ruta: string): string => `${ruta}.bak`;

const MENSAJE_JSON_DANADO = 'El archivo no es un proyecto JasWave válido (JSON dañado)';

const existeSeguro = async (fileService: FileService, ruta: string): Promise<boolean> => {
  try {
    return await fileService.existe(ruta);
  } catch {
    return false;
  }
};

/**
 * Lee, migra y valida un archivo. `rutaLectura` puede ser el `.bak`;
 * `rutaProyecto` es la ruta `.jaswave` que quedará asociada al proyecto.
 */
const cargarDesde = async (
  rutaLectura: string,
  rutaProyecto: string,
  fileService: FileService,
  opciones: OpcionesCargaProyecto,
  avisarRespaldo: boolean,
): Promise<ProjectState> => {
  const sufijoRespaldo = async (): Promise<{ texto: string; hay: boolean }> => {
    if (!avisarRespaldo) return { texto: '', hay: false };
    const hay = await existeSeguro(fileService, rutaRespaldo(rutaProyecto));
    return {
      hay,
      texto: hay ? `. Existe una copia de seguridad (${rutaRespaldo(rutaProyecto)}) que puede recuperarse` : '',
    };
  };

  let contenido: string;
  try {
    contenido = await fileService.leer(rutaLectura);
  } catch (e) {
    throw new ErrorCargaProyecto(`No se pudo leer el archivo .jaswave: ${e instanceof Error ? e.message : 'error desconocido'}`, 'lectura');
  }

  let crudo: unknown;
  try {
    crudo = JSON.parse(contenido);
  } catch {
    const r = await sufijoRespaldo();
    throw new ErrorCargaProyecto(`${MENSAJE_JSON_DANADO}${r.texto}`, 'json', r.hay);
  }

  let migrado: unknown;
  try {
    migrado = migrarArchivo(crudo, opciones.migraciones).archivo;
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'error desconocido';
    const codigo: CodigoErrorCarga = mensaje.startsWith('Versión de formato') ? 'version' : 'estructura';
    const r = codigo === 'estructura' ? await sufijoRespaldo() : { texto: '', hay: false };
    throw new ErrorCargaProyecto(`${mensaje}${r.texto}`, codigo, r.hay);
  }

  if (!archivoValido(migrado)) {
    const r = await sufijoRespaldo();
    throw new ErrorCargaProyecto(`Archivo .jaswave inválido: estructura incorrecta${r.texto}`, 'estructura', r.hay);
  }

  // Notas MIDI corruptas (NaN → null en JSON) se descartan en vez de impedir abrir el proyecto.
  let notasEliminadas = 0;
  {
    const m = migrado as { project?: unknown };
    if (m && typeof m === 'object' && m.project) {
      const r = repararNotasMidi(m.project);
      notasEliminadas = r.eliminadas;
      if (r.eliminadas > 0) migrado = { ...m, project: r.proyecto };
    }
  }

  const validacion = validarProyectoArchivo(migrado);
  if (!validacion.ok) {
    const r = await sufijoRespaldo();
    throw new ErrorCargaProyecto(`${validacion.error}${r.texto}`, 'estructura', r.hay);
  }

  const archivo = validacion.datos as unknown as ProyectoArchivo;
  const proyectoReconstruido = reconstruirRouting(archivo.project);

  if (archivo.audioReferences && Object.keys(archivo.audioReferences).length > 0) {
    const faltantes = await verificarReferenciasAudio(archivo.audioReferences, fileService);
    if (faltantes.length > 0) {
      console.warn(`Referencias de audio no encontradas: ${faltantes.join(', ')}`);
    }
  }

  if (notasEliminadas > 0) {
    console.warn(`Proyecto reparado: ${notasEliminadas} nota(s) MIDI inválidas descartadas`);
  }
  // modificado=true si hubo reparación: el siguiente guardado escribe el archivo corregido.
  return { ...proyectoReconstruido, ruta: rutaProyecto, modificado: notasEliminadas > 0 };
};

/**
 * Carga un `.jaswave`: parse → migraciones de formato → validación de esquema →
 * reconstrucción de routing. Los errores son `ErrorCargaProyecto` con mensaje
 * en español; si el archivo está dañado y existe `.bak`, el mensaje lo indica.
 */
export const cargarProyecto = async (ruta: string, fileService: FileService, opciones: OpcionesCargaProyecto = {}): Promise<ProjectState> => {
  validarExtensionRuta(ruta);
  return cargarDesde(ruta, ruta, fileService, opciones, true);
};

export interface ResultadoCargaConRespaldo {
  proyecto: ProjectState;
  usadoRespaldo: boolean;
  /** Mensaje del fallo del archivo principal cuando se usó el respaldo. */
  errorOriginal?: string;
}

const CODIGOS_RECUPERABLES: ReadonlySet<CodigoErrorCarga> = new Set(['json', 'estructura']);

/**
 * Igual que `cargarProyecto`, pero si el archivo principal está dañado (JSON o
 * estructura) y existe `${ruta}.bak`, carga automáticamente la copia de seguridad.
 * Una versión futura NO se recupera del respaldo (hay que actualizar JasWave).
 */
export const cargarProyectoConRespaldo = async (
  ruta: string,
  fileService: FileService,
  opciones: OpcionesCargaProyecto = {},
): Promise<ResultadoCargaConRespaldo> => {
  validarExtensionRuta(ruta);
  try {
    return { proyecto: await cargarDesde(ruta, ruta, fileService, opciones, false), usadoRespaldo: false };
  } catch (e) {
    if (!(e instanceof ErrorCargaProyecto) || !CODIGOS_RECUPERABLES.has(e.codigo)) throw e;
    const bak = rutaRespaldo(ruta);
    if (!(await existeSeguro(fileService, bak))) throw e;
    try {
      const proyecto = await cargarDesde(bak, ruta, fileService, opciones, false);
      // Hay que volver a guardar para reparar el archivo principal.
      return { proyecto: { ...proyecto, modificado: true }, usadoRespaldo: true, errorOriginal: e.message };
    } catch (eBak) {
      const detalle = eBak instanceof Error ? eBak.message : 'error desconocido';
      throw new ErrorCargaProyecto(`${e.message}. La copia de seguridad (${bak}) tampoco se pudo cargar: ${detalle}`, e.codigo, true);
    }
  }
};

export { FORMATO_ACTUAL } from './ciclo-vida';

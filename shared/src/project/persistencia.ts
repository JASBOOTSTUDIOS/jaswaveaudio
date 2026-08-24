import type { ProjectState } from '../types/proyecto';
import type { AudioReference, ProyectoArchivo } from './ciclo-vida';
import { proyectoParaGuardar, archivoValido, validarExtensionRuta, validarIntegridadProyecto, reconstruirRouting, verificarReferenciasAudio, FORMATO_ACTUAL } from './ciclo-vida';

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

export const cargarProyecto = async (ruta: string, fileService: FileService): Promise<ProjectState> => {
  validarExtensionRuta(ruta);

  let contenido: string;
  try {
    contenido = await fileService.leer(ruta);
  } catch (e) {
    throw new Error(`No se pudo leer el archivo .jaswave: ${e instanceof Error ? e.message : 'error desconocido'}`);
  }

  let archivo: unknown;
  try {
    archivo = JSON.parse(contenido);
  } catch {
    throw new Error('Archivo .jaswave corrupto: JSON inválido');
  }

  const tieneVersionIncompatible = (archivo: unknown): boolean => {
    if (!archivo || typeof archivo !== 'object') return false;
    const candidato = archivo as Record<string, unknown>;
    return typeof candidato.version === 'number' && candidato.version !== FORMATO_ACTUAL;
  };

  if (!archivoValido(archivo)) {
    if (tieneVersionIncompatible(archivo)) {
      const version = (archivo as Record<string, unknown>).version as number;
      throw new Error(`Versión de formato no soportada: ${version}. Se esperaba ${FORMATO_ACTUAL}`);
    }
    throw new Error('Archivo .jaswave inválido: estructura incorrecta');
  }

  try {
    const proyecto = validarIntegridadProyecto(archivo.project);
    const proyectoReconstruido = reconstruirRouting(proyecto);

    if (archivo.audioReferences && Object.keys(archivo.audioReferences).length > 0) {
      const faltantes = await verificarReferenciasAudio(archivo.audioReferences, fileService);
      if (faltantes.length > 0) {
        console.warn(`Referencias de audio no encontradas: ${faltantes.join(', ')}`);
      }
    }

    return { ...proyectoReconstruido, ruta, modificado: false };
  } catch (e) {
    if (e instanceof Error && e.message.includes('corrupto')) {
      throw e;
    }
    throw new Error(`Error al validar el proyecto cargado: ${e instanceof Error ? e.message : 'desconocido'}`);
  }
};

export { FORMATO_ACTUAL } from './ciclo-vida';

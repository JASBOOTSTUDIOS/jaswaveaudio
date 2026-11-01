/**
 * Migraciones de versión del archivo `.jaswave`.
 *
 * Propósito:
 *   Llevar un archivo guardado con un formato anterior (`version` < FORMATO_ACTUAL)
 *   hasta el formato actual antes de validarlo y cargarlo.
 *
 * Importancia:
 *   - Los proyectos antiguos siguen abriéndose cuando cambia el formato.
 *   - Un archivo de una versión futura se rechaza con un mensaje claro
 *     (actualizar JasWave) en lugar de cargarse a medias.
 *
 * Función:
 *   Registro `{ desde, hacia, migrar }[]` (vacío mientras FORMATO_ACTUAL = 1) y
 *   `migrarArchivo(raw, registro?)`, que aplica la cadena de migraciones. El
 *   registro es inyectable para poder probar migraciones de ejemplo.
 */

import { FORMATO_ACTUAL } from './ciclo-vida';

/** Archivo crudo (JSON parseado) en cualquier versión de formato. */
export type ArchivoCrudo = Record<string, unknown> & { version: number };

export interface MigracionArchivo {
  desde: number;
  hacia: number;
  descripcion?: string;
  migrar(archivo: ArchivoCrudo): ArchivoCrudo;
}

/** Migraciones registradas de formato de archivo. Vacío: FORMATO_ACTUAL = 1 es el primero. */
export const MIGRACIONES_ARCHIVO: readonly MigracionArchivo[] = [];

export interface ResultadoMigracionArchivo {
  archivo: ArchivoCrudo;
  versionOriginal: number;
  migracionesAplicadas: string[];
}

export const mensajeVersionFutura = (version: number, formatoActual = FORMATO_ACTUAL): string =>
  `Versión de formato no soportada: ${version}. Este proyecto se guardó con una versión más reciente de JasWave ` +
  `(esta versión abre hasta el formato ${formatoActual}). Actualiza JasWave para abrirlo.`;

/**
 * Migra un archivo crudo hasta `formatoActual`.
 * Lanza si la versión falta, es inválida, es futura o no hay camino de migración.
 */
export const migrarArchivo = (
  raw: unknown,
  registro: readonly MigracionArchivo[] = MIGRACIONES_ARCHIVO,
  formatoActual: number = FORMATO_ACTUAL,
): ResultadoMigracionArchivo => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Archivo .jaswave inválido: estructura incorrecta (se esperaba un objeto)');
  }
  const version = (raw as Record<string, unknown>).version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    throw new Error('Archivo .jaswave inválido: estructura incorrecta (falta "version" o no es un entero válido)');
  }
  if (version > formatoActual) {
    throw new Error(mensajeVersionFutura(version, formatoActual));
  }

  let archivo = raw as ArchivoCrudo;
  const migracionesAplicadas: string[] = [];
  while (archivo.version < formatoActual) {
    const actual = archivo.version;
    const paso = registro.find((m) => m.desde === actual);
    if (!paso || paso.hacia <= actual || paso.hacia > formatoActual) {
      throw new Error(`Versión de formato no soportada: ${actual}. No hay migración disponible hacia el formato ${formatoActual}`);
    }
    const migrado = paso.migrar(archivo);
    archivo = { ...migrado, version: paso.hacia };
    migracionesAplicadas.push(`${paso.desde}→${paso.hacia}`);
  }

  return { archivo, versionOriginal: version, migracionesAplicadas };
};

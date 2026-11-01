/**
 * Conflictos por cambio del proyecto en disco (U7).
 *
 * Propósito:
 *   Detectar que el `.jaswave` cambió fuera de JasWave (otra instancia, otra
 *   herramienta, sincronización) antes de sobrescribirlo.
 *
 * Importancia:
 *   - Evita perder el trabajo de otra persona o de otra versión del proyecto.
 *   - La comparación es por `mtime` + tamaño: la firma conocida se toma al
 *     cargar o al guardar, y se compara con la firma actual del archivo.
 *
 * Función:
 *   Exporta `FirmaArchivo`, `EleccionConflicto`, `ConflictoDisco`,
 *   `mismaFirma`, `hayConflictoDisco`, `detectarConflictoDisco` y
 *   `mensajeConflictoDisco` (lógica pura, sin dependencias de UI ni de disco).
 */

/** Firma mínima de un archivo en disco (mtime en ms y tamaño en bytes). */
export type FirmaArchivo = {
  mtimeMs: number
  size: number
}

/** Qué hacer cuando el archivo cambió: pisarlo, guardarlo en otro sitio o cancelar. */
export type EleccionConflicto = 'sobrescribir' | 'guardar-como' | 'cancelar'

export type ConflictoDisco = {
  ruta: string
  /** Firma conocida (al cargar o al guardar). */
  esperado: FirmaArchivo
  /** Firma actual del archivo en disco. */
  actual: FirmaArchivo
}

/**
 * Dos firmas son la misma si el mtime (redondeado a milisegundos) y el tamaño
 * coinciden. El redondeo evita falsos positivos por precisión de coma flotante.
 */
export function mismaFirma(a: FirmaArchivo, b: FirmaArchivo): boolean {
  return Math.round(a.mtimeMs) === Math.round(b.mtimeMs) && a.size === b.size
}

/**
 * ¿El archivo cambió respecto a la firma conocida?
 * - Sin firma conocida (nunca se cargó/guardó): no hay conflicto.
 * - Sin archivo en disco (fue borrado): no hay conflicto; se recrea al guardar.
 */
export function hayConflictoDisco(
  esperado: FirmaArchivo | null | undefined,
  actual: FirmaArchivo | null | undefined,
): boolean {
  if (!esperado || !actual) return false
  return !mismaFirma(esperado, actual)
}

/** Devuelve el conflicto si lo hay, o `null` si el archivo sigue igual. */
export function detectarConflictoDisco(
  ruta: string,
  esperado: FirmaArchivo | null | undefined,
  actual: FirmaArchivo | null | undefined,
): ConflictoDisco | null {
  if (!hayConflictoDisco(esperado, actual)) return null
  return { ruta, esperado: esperado as FirmaArchivo, actual: actual as FirmaArchivo }
}

/** Texto para el diálogo de conflicto. */
export function mensajeConflictoDisco(conflicto: ConflictoDisco): string {
  return `El archivo cambió en disco desde la última vez que lo guardaste: ${conflicto.ruta}`
}

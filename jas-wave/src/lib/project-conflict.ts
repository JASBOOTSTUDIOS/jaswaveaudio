/**
 * Firma de los archivos de proyecto en disco (U7).
 *
 * Guarda la firma (mtime + tamaño) conocida de cada `.jaswave` —la que se tomó
 * al cargarlo o al guardarlo— y la compara con la actual antes de sobrescribir.
 * Así se detecta que el proyecto cambió fuera de JasWave.
 */

import {
  detectarConflictoDisco,
  type ConflictoDisco,
  type FirmaArchivo,
} from '../../../shared/src/project/conflicto-disco'

export type { ConflictoDisco, FirmaArchivo }

const firmas = new Map<string, FirmaArchivo>()

/** Firma conocida del archivo (o null si no se ha cargado/guardado aún). */
export function firmaConocida(ruta: string): FirmaArchivo | null {
  return firmas.get(normalizar(ruta)) ?? null
}

/** Registra la firma actual del archivo (tras cargar o guardar). */
export function registrarFirmaArchivo(ruta: string, firma: FirmaArchivo | null): void {
  const clave = normalizar(ruta)
  if (!firma) {
    firmas.delete(clave)
    return
  }
  firmas.set(clave, firma)
}

/** Firma actual del archivo en disco (null si no existe o no se puede leer). */
export async function leerFirmaArchivo(ruta: string): Promise<FirmaArchivo | null> {
  try {
    const stat = await window.electron?.fileStat?.(ruta)
    if (!stat) return null
    return { mtimeMs: stat.mtimeMs, size: stat.size }
  } catch {
    return null
  }
}

/**
 * Conflicto del proyecto en disco, o null si el archivo sigue igual.
 * Sin firma conocida no hay conflicto (el proyecto nunca se guardó aquí).
 */
export async function detectarConflictoProyecto(ruta: string): Promise<ConflictoDisco | null> {
  if (!ruta) return null
  const esperado = firmaConocida(ruta)
  if (!esperado) return null
  const actual = await leerFirmaArchivo(ruta)
  return detectarConflictoDisco(ruta, esperado, actual)
}

/** Tras guardar: la firma del archivo pasa a ser la conocida. */
export async function refrescarFirmaArchivo(ruta: string): Promise<void> {
  if (!ruta) return
  const actual = await leerFirmaArchivo(ruta)
  registrarFirmaArchivo(ruta, actual)
}

function normalizar(ruta: string): string {
  return ruta.replace(/\\/g, '/').toLowerCase()
}

/** Solo tests: limpia el registro de firmas. */
export function _reiniciarFirmasArchivo(): void {
  firmas.clear()
}

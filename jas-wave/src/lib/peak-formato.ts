/**
 * Formato del archivo `.peak` (caché de la forma de onda junto al audio).
 *
 * Es JSON versionado con la firma del audio de origen (tamaño + mtime): si el audio se reemplaza o se
 * edita, la firma deja de coincidir y la caché se descarta en vez de mostrar una forma de onda obsoleta.
 * Los `.peak` antiguos (un array plano sin versión ni firma) no se pueden validar y se regeneran.
 */

export const PEAK_FORMATO = 'jaswave-peak'
export const PEAK_VERSION = 2
/** Mínimo de valores para considerar utilizable una forma de onda. */
export const PEAK_MIN_VALORES = 4
export const PEAK_MAX_VALORES = 1 << 20

export type FirmaOrigen = { size: number; mtimeMs: number }

export type PeakArchivo = {
  formato: typeof PEAK_FORMATO
  version: typeof PEAK_VERSION
  valores: number
  origen: FirmaOrigen | null
  peaks: number[]
}

export function serializarPeak(peaks: ArrayLike<number>, origen: FirmaOrigen | null): string {
  const lista = Array.from(peaks)
  const archivo: PeakArchivo = { formato: PEAK_FORMATO, version: PEAK_VERSION, valores: lista.length, origen, peaks: lista }
  return JSON.stringify(archivo)
}

const mismaFirma = (a: FirmaOrigen, b: FirmaOrigen): boolean => a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 1

/**
 * Interpreta un `.peak`. Devuelve `null` (descartar y regenerar) si el contenido no es válido, es de otro
 * formato o versión, está truncado, contiene valores no finitos o si el audio de origen ha cambiado.
 * `origenActual` es la firma del audio ahora mismo (null = no se pudo obtener: no se puede validar).
 */
export function leerPeak(contenido: string, origenActual: FirmaOrigen | null): number[] | null {
  let obj: unknown
  try {
    obj = JSON.parse(contenido)
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const a = obj as Partial<PeakArchivo>
  if (a.formato !== PEAK_FORMATO || a.version !== PEAK_VERSION) return null
  if (!Array.isArray(a.peaks) || a.peaks.length < PEAK_MIN_VALORES || a.peaks.length > PEAK_MAX_VALORES) return null
  if (a.valores !== a.peaks.length) return null // archivo truncado o editado a mano
  for (const v of a.peaks) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < -16 || v > 16) return null
  }
  // Con firma en el archivo: exige que el audio actual coincida; sin poder comprobarlo, no se confía.
  if (a.origen) {
    if (!origenActual) return null
    if (!mismaFirma(a.origen, origenActual)) return null
  }
  return a.peaks
}

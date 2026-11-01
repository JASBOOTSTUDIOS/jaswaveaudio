/**
 * Escalas de los medidores del mixer: VU en dB alineado con el fader y alturas del mini espectro.
 */
import { dbAPorcentaje, linealADb } from './audio-conversions'

/** Pico a partir del cual se considera clip (el host satura los picos a 1.0 = 0 dBFS). */
export const UMBRAL_CLIP = 0.999

/** Pico lineal (≥ 0) → % de altura del VU desde abajo, en la misma escala que el fader (+12…−60 dB). */
export function picoAPorcentajeVu(peak: number): number {
  if (!(peak > 0)) return 0
  return 100 - dbAPorcentaje(linealADb(peak))
}

/** Rango visible del mini espectro (dBFS). */
export const ESPECTRO_DB_MIN = -90
export const ESPECTRO_DB_MAX = 0

/** Altura (0..1) de cada columna del espectro; −140 dBFS (sin señal) queda en 0. */
export function alturasEspectro(
  columnas: ArrayLike<number>,
  dbMin = ESPECTRO_DB_MIN,
  dbMax = ESPECTRO_DB_MAX,
): number[] {
  const out: number[] = []
  for (let i = 0; i < columnas.length; i++) {
    const v = columnas[i] ?? -140
    out.push(Math.max(0, Math.min(1, (v - dbMin) / (dbMax - dbMin))))
  }
  return out
}

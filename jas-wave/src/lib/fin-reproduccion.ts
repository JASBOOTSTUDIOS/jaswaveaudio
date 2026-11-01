/**
 * Qué hacer cuando la reproducción llega al final (G1/transporte).
 *
 * - Loop activo con región: al llegar al final de la región se vuelve a su inicio.
 * - Loop activo sin región válida: se repite la canción entera (del 0 al final del contenido).
 * - Sin loop y «detener al final» activo (por defecto): pasado el último clip, cuando la cola de
 *   reverb se apaga (o como mucho a los 10 s), se detiene y vuelve al inicio.
 * - Sin loop y la opción desactivada: sigue sin fin.
 */

import { COLA_MAXIMA_SEGUNDOS, UMBRAL_SILENCIO_DB } from '../../../shared/src/render/fin-proyecto'

export type DecisionFin = { tipo: 'seguir' } | { tipo: 'saltar'; segundos: number } | { tipo: 'detener' }

export type EntradaFin = {
  ahoraSec: number
  /** Final del último clip audible; null si el proyecto no tiene contenido. */
  finContenidoSec: number | null
  loop: { activo: boolean; inicioSec?: number; finSec?: number }
  detenerAlFinal: boolean
  /** Pico lineal (0..1) del master en este instante. */
  picoMaster: number
  /** Segundos seguidos que el master lleva por debajo del umbral de silencio. */
  silencioSec: number
}

/** Margen tras el final del contenido antes de considerar el silencio (evita cortar la última nota). */
export const MARGEN_FIN_SEC = 0.25
/** Silencio seguido exigido antes de detener. */
export const SILENCIO_PARA_DETENER_SEC = 0.5

export function umbralSilencioLineal(): number {
  return Math.pow(10, UMBRAL_SILENCIO_DB / 20)
}

export function decidirFinReproduccion(e: EntradaFin): DecisionFin {
  if (e.loop.activo) {
    const ini = e.loop.inicioSec ?? 0
    const fin = e.loop.finSec ?? 0
    if (fin > ini + 0.05) return e.ahoraSec >= fin ? { tipo: 'saltar', segundos: ini } : { tipo: 'seguir' }
    // Loop sin región: toda la canción.
    if (e.finContenidoSec != null && e.finContenidoSec > 0.05 && e.ahoraSec >= e.finContenidoSec) {
      return { tipo: 'saltar', segundos: 0 }
    }
    return { tipo: 'seguir' }
  }
  if (!e.detenerAlFinal || e.finContenidoSec == null) return { tipo: 'seguir' }
  const pasado = e.ahoraSec - e.finContenidoSec
  if (pasado < MARGEN_FIN_SEC) return { tipo: 'seguir' }
  if (pasado >= COLA_MAXIMA_SEGUNDOS) return { tipo: 'detener' }
  return e.silencioSec >= SILENCIO_PARA_DETENER_SEC ? { tipo: 'detener' } : { tipo: 'seguir' }
}

/**
 * Distribución de las tiras del mixer.
 * - El ANCHO solo lo cambia el usuario (Ctrl + rueda sobre el mixer, o el botón de colapsar); nunca el alto
 *   del panel.
 * - El ALTO decide qué se ve. Al faltar alto se quitan, por orden: entradas/FX/envíos (y el espectro), luego el
 *   paneo. Siempre quedan nombre, M/S y el bloque de volumen (fader de 160 px + lectura).
 */

export const ANCHO_TIRA = { min: 52, max: 180, defecto: 124, paso: 8 } as const

/** Por debajo de este ancho la tira es «estrecha»: lectura de dB y pico apilados, sin botón de espectro. */
export const ANCHO_ESTRECHO = 96

export function limitarAnchoTira(px: number): number {
  if (!Number.isFinite(px)) return ANCHO_TIRA.defecto
  return Math.max(ANCHO_TIRA.min, Math.min(ANCHO_TIRA.max, Math.round(px)))
}

/** Ctrl + rueda: hacia arriba ensancha, hacia abajo estrecha (un paso por evento). */
export function anchoConRueda(actual: number, deltaY: number): number {
  if (deltaY === 0) return limitarAnchoTira(actual)
  return limitarAnchoTira(actual + (deltaY < 0 ? ANCHO_TIRA.paso : -ANCHO_TIRA.paso))
}

/** Alto fijo de una tira sin extras: padding, nombre, M/S, color y la barra de scroll horizontal. */
const ALTO_BASE = 84
/** Bloque de volumen: fader 160 + lectura (apilada en tiras estrechas). */
const ALTO_BLOQUE = 180
const ALTO_BLOQUE_ESTRECHO = 200
/** Paneo como barra horizontal fina (cuando la perilla no cabe). */
const ALTO_PANEO_BARRA = 20
/** Perilla de paneo con su valor. */
const ALTO_PANEO = 54
/** En tiras estrechas los cuatro botones (M, S, monitor, grabación) pasan a dos filas. */
const ALTO_BOTONES_ESTRECHO = 20
/**
 * Extras: parte fija (selector de entrada MIDI/audio y medidor, ~34 px) más el mínimo útil de la zona con
 * scroll, que solo contiene los FX (~30 px). Por encima, los FX ocupan TODO el alto sobrante, así que nunca
 * queda un hueco vacío en la tira.
 */
const ALTO_EXTRAS_MIN = 64

/** Alto mínimo (px) del mixer para mostrar siempre nombre, botones de la pista y volumen. */
export function altoMinimoMixer(estrecho: boolean): number {
  return ALTO_BASE + (estrecho ? ALTO_BLOQUE_ESTRECHO + ALTO_BOTONES_ESTRECHO : ALTO_BLOQUE)
}

/** Umbrales ascendentes de alto: [paneo en barra, paneo en perilla, completo]. */
export function umbralesMixer(estrecho: boolean): readonly [number, number, number] {
  const base = altoMinimoMixer(estrecho)
  const perilla = base + ALTO_PANEO
  return [base + ALTO_PANEO_BARRA, perilla, perilla + ALTO_EXTRAS_MIN] as const
}

export type PaneoMixer = 'oculto' | 'barra' | 'perilla'

/** Qué muestra cada nivel (0 = solo M/S + volumen, 1 = + paneo en barra, 2 = + perilla, 3 = + FX y envíos). */
export function seccionesMixer(nivel: number): { paneo: PaneoMixer; extras: boolean } {
  return { paneo: nivel >= 2 ? 'perilla' : nivel >= 1 ? 'barra' : 'oculto', extras: nivel >= 3 }
}

const CLAVE_ANCHO = 'jaswave.mixer.anchoTira'

export function leerAnchoTira(): number {
  try {
    const v = Number(localStorage.getItem(CLAVE_ANCHO))
    return v > 0 ? limitarAnchoTira(v) : ANCHO_TIRA.defecto
  } catch {
    return ANCHO_TIRA.defecto
  }
}

export function guardarAnchoTira(px: number): void {
  try {
    localStorage.setItem(CLAVE_ANCHO, String(limitarAnchoTira(px)))
  } catch {
    /* sin almacenamiento: el ancho vale solo para esta sesión */
  }
}

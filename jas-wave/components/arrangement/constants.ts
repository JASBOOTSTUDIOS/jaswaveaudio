/** Constantes compartidas del Arrangement (ADR-0010). */

/** Altura base de pista (TCP compacto estilo Reaper; FX/instrumentos viven en el Mixer). */
export const ROW_H = 56
export const HEADER_H = 40
/** Ancho de la columna TCP (cabeceras). */
export const HEADER_W = 180
/** Carriles fantasma cuando no hay pistas (timeline se ve completa). */
export const EMPTY_LANE_COUNT = 8
export const MIN_TOTAL_BEATS = 640
/** Zoom base: px por beat a zoom=1 */
export const BASE_PIXELS_PER_BEAT = 5
/** Overview → muestra a muestra (estilo Reaper) */
export const ARRANGE_MIN_ZOOM = 0.05
export const ARRANGE_MAX_ZOOM = 256
/** Altura mínima al hacer zoom vertical (Ctrl+scroll). */
export const ROW_H_MIN = 36

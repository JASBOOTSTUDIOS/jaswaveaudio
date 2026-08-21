/**
 * Utilidades de conversión de audio para la UI del DAW.
 *
 * Propósito:
 *   Centralizar todas las conversiones entre lineal, dB, porcentaje
 *   y display para que la UI sea siempre congruente con los valores
 *   reales del estado.
 *
 * Importancia:
 *   - Fuente única de verdad para conversiones de audio.
 *   - Garantiza que los valores mostrados en la UI coincidan exactamente
 *     con los valores almacenados en el estado.
 *   - Facilita que la IA reciba datos exactos y consistentes.
 */

// ── Constantes ──────────────────────────────────────────────────

export const DB_SUPERIOR = 12
export const DB_INFERIOR = -60
export const DB_ESCALA = [12, 6, 0, -6, -12, -24, -48, -60] as const

// ── Conversión Lineal ↔ dB ─────────────────────────────────────

/**
 * Convierte volumen lineal (0.0–1.0) a decibelios.
 * `0.0` → `-∞` (representado como DB_INFERIOR)
 * `1.0` → `0 dB`
 * `>1.0` → positivo dB
 */
export function linealADb(vol: number): number {
  if (vol <= 0.0001) return DB_INFERIOR
  return 20 * Math.log10(vol)
}

/**
 * Convierte decibelios a volumen lineal (0.0–1.0).
 * `0 dB` → `1.0`
 * `-6 dB` → `0.5`
 * `≤ DB_INFERIOR` → `0.0`
 */
export function dbALineal(db: number): number {
  if (db <= DB_INFERIOR) return 0
  return Math.pow(10, db / 20)
}

// ── Conversión dB ↔ Posición del Fader (porcentaje) ────────────

/**
 * Convierte dB a porcentaje de posición del fader (0%=arriba, 100%=abajo).
 * `+12 dB` → `0%`
 * `0 dB` → `16.67%`
 * `-60 dB` → `100%`
 */
export function dbAPorcentaje(db: number): number {
  const clamped = Math.max(DB_INFERIOR, Math.min(DB_SUPERIOR, db))
  return ((DB_SUPERIOR - clamped) / (DB_SUPERIOR - DB_INFERIOR)) * 100
}

/**
 * Convierte porcentaje de posición del fader a dB.
 * Inverso de `dbAPorcentaje`.
 */
export function porcentajeADb(pct: number): number {
  const clamped = Math.max(0, Math.min(100, pct))
  return DB_SUPERIOR - (clamped / 100) * (DB_SUPERIOR - DB_INFERIOR)
}

// ── Formateo de Display ────────────────────────────────────────

/**
 * Formatea un valor dB para mostrar en la UI.
 * `0` → `"0.0"`, `-6.123` → `"-6.1"`, `+3.456` → `"+3.5"`, `≤ DB_INFERIOR` → `"−∞"`
 */
export function formatearDb(db: number): string {
  if (db <= DB_INFERIOR) return '−∞'
  if (db === 0) return '0.0'
  return db > 0 ? `+${db.toFixed(1)}` : db.toFixed(1)
}

// ── Conversión Pan ─────────────────────────────────────────────

/**
 * Convierte pan lineal (-1.0 a 1.0) a display (-100 a +100).
 */
export function panADisplay(pan: number): number {
  return Math.round(pan * 100)
}

/**
 * Convierte display pan (-100 a +100) a lineal (-1.0 a 1.0).
 */
export function displayAPan(display: number): number {
  return Math.max(-1, Math.min(1, display / 100))
}

/**
 * Formatea pan para display: `"L42"`, `"R18"`, `"C"`
 */
export function formatearPan(pan: number): string {
  const display = panADisplay(pan)
  if (display === 0) return 'C'
  return display > 0 ? `R${display}` : `L${Math.abs(display)}`
}

// ── Conversión Tiempo ──────────────────────────────────────────

/**
 * Convierte beats a posición de compás y beat (1-indexed).
 */
export function beatsACompasBeat(beats: number, beatsPorCompas = 4): { compas: number; beat: number } {
  const compas = Math.floor(beats / beatsPorCompas) + 1
  const beat = Math.floor(beats % beatsPorCompas) + 1
  return { compas, beat }
}

/**
 * Convierte milisegundos a tiempo formateado `MM:SS.mmm`.
 */
export function msATiempoFormateado(ms: number): string {
  const totalSeg = Math.floor(ms / 1000)
  const minutos = Math.floor(totalSeg / 60)
  const segundos = totalSeg % 60
  const milis = Math.floor(ms % 1000)
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}.${String(milis).padStart(3, '0')}`
}

/**
 * Convierte milisegundos a compás:beat para display.
 */
export function msACompasBeat(ms: number, bpm: number, beatsPerBar = 4): { compas: number; beat: number } {
  const msPerBeat = 60000 / bpm
  const totalBeats = ms / msPerBeat
  const compas = Math.floor(totalBeats / beatsPerBar) + 1
  const beat = Math.floor(totalBeats % beatsPerBar) + 1
  return { compas, beat }
}

/**
 * Convierte beats a segundos.
 */
export function beatsASegundos(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

/**
 * Convierte segundos a beats.
 */
export function segundosABeats(segundos: number, bpm: number): number {
  return (segundos * bpm) / 60
}

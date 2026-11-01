/**
 * Captura de CC durante la grabación MIDI (pedales 64/66/67/69 y expresión 1/11) y conversión a lanes de
 * `clip.expression.cc`.
 *
 * Contrato de `valor` en los puntos de CC del clip: NORMALIZADO 0..1 (CC MIDI = round(valor * 127)), tanto al
 * grabar como al reproducir (playback-provider usa `valorCcAMidi`). `tiempo` en beats relativos al inicio del
 * clip. Los pedales se guardan con curva 'step'; la expresión (CC1/CC11) con 'linear'.
 *
 * Los mensajes deben llegar ya unificados por `unificarPedal` (el PSR-E373 manda pisado/suelto por canales
 * distintos): aquí no se vuelve a agregar por canal, solo se descartan repeticiones del mismo valor.
 */

import { esPedalConmutado } from './midi-pedal'

/** CC que se graban en el clip: pedales conmutados + modulación (1) y expresión (11). */
export const CC_GRABABLES: readonly number[] = [1, 11, 64, 66, 67, 69]

export function esCcGrabable(cc: number): boolean {
  return CC_GRABABLES.includes(cc)
}

export type CcGrabado = { cc: number; value: number; timeSec: number }

export type CcRecorderState = {
  startSec: number
  /** Eventos en orden de llegada (value 0..127). */
  events: CcGrabado[]
  /** Último valor visto de cada CC (para no repetir). */
  last: Map<number, number>
  /** Estado de cada CC al empezar la toma (0..127), solo los distintos de 0. */
  inicial: Map<number, number>
}

/**
 * @param estadoInicial valor (0..127) de cada CC grabable en el instante de empezar (p. ej. pedal ya pisado);
 *   solo se incluyen los distintos de 0.
 */
export function createCcRecorder(startSec: number, estadoInicial?: ReadonlyMap<number, number>): CcRecorderState {
  const last = new Map<number, number>()
  if (estadoInicial) for (const [cc, v] of estadoInicial) if (esCcGrabable(cc)) last.set(cc, clamp127(v))
  return { startSec, events: [], last, inicial: new Map(last) }
}

function clamp127(v: number): number {
  return Math.max(0, Math.min(127, Math.round(v)))
}

export function ccRecorderOn(state: CcRecorderState, cc: number, value: number, timeSec: number): CcRecorderState {
  if (!esCcGrabable(cc)) return state
  const v = clamp127(value)
  const prev = state.last.get(cc)
  if (prev === v) return state
  // El pedal que nunca se vio y llega a 0 no aporta nada; los CC continuos sí (fijan el nivel).
  if (prev === undefined && v === 0 && esPedalConmutado(cc)) return state
  const last = new Map(state.last)
  last.set(cc, v)
  return { ...state, events: state.events.concat({ cc, value: v, timeSec }), last }
}

export type PuntoCcClip = { id: string; tiempo: number; valor: number; curva: 'step' | 'linear' }
export type LaneCcClip = { cc: number; nombre: string; puntos: PuntoCcClip[] }

const NOMBRES: Record<number, string> = {
  1: 'Modulación (CC1)',
  11: 'Expresión (CC11)',
  64: 'Sustain (CC64)',
  66: 'Sostenuto (CC66)',
  67: 'Pedal suave (CC67)',
  69: 'Hold 2 (CC69)',
}

export type OpcionesLanes = {
  /** Inicio del clip en segundos de línea de tiempo (el mismo que usa recordedToClipNotes). */
  clipStartSec: number
  bpm: number
  /** Fin de la toma en segundos de línea de tiempo (parada, o fin del punch). */
  endSec: number
  /** Duración del clip en beats: ningún punto la supera. */
  duracionBeats: number
  /** Ventana de punch: solo se conserva lo que cae dentro; el estado previo pasa a ser el punto inicial. */
  punch?: { startSec: number; endSec: number } | null
}

const EPS = 1e-6

/**
 * Convierte la captura en lanes. Reglas:
 *  - Lo anterior al inicio del clip (o de la ventana de punch) se colapsa en un punto inicial en 0 si su valor ≠ 0
 *    (pedal ya pisado al empezar).
 *  - Pedales: curva 'step'; al final se añade el punto 0 (suelta) si quedaron pisados, para no dejar sustain colgado.
 *  - CC continuos: 'linear'; sin punto final.
 *  - Ningún punto cae fuera de [0, duracionBeats]; los empates de tiempo conservan el último valor.
 */
export function ccGrabadosALanes(state: CcRecorderState, o: OpcionesLanes): LaneCcClip[] {
  const spb = 60 / Math.max(1, o.bpm)
  const desde = Math.max(o.clipStartSec, o.punch ? o.punch.startSec : -Infinity)
  const hasta = Math.min(o.endSec, o.punch ? o.punch.endSec : Infinity)
  const dur = Math.max(0, o.duracionBeats)
  const porCc = new Map<number, CcGrabado[]>()
  for (const e of state.events) {
    const arr = porCc.get(e.cc)
    if (arr) arr.push(e)
    else porCc.set(e.cc, [e])
  }
  const lanes: LaneCcClip[] = []
  const ccs = new Set<number>([...porCc.keys(), ...state.inicial.keys()])
  for (const cc of ccs) {
    const evs = (porCc.get(cc) ?? []).slice().sort((a, b) => a.timeSec - b.timeSec)
    const pedal = esPedalConmutado(cc)
    const curva = pedal ? 'step' : 'linear'
    // Estado a la entrada de la ventana = último evento previo; si no hubo, el inicial de la toma.
    let inicial: number | undefined = state.inicial.get(cc)
    const dentro: CcGrabado[] = []
    for (const e of evs) {
      if (e.timeSec < desde - EPS) inicial = e.value
      else if (e.timeSec <= hasta + EPS) dentro.push(e)
    }
    const pts: Array<{ t: number; v: number }> = []
    if (inicial !== undefined && inicial > 0) pts.push({ t: 0, v: inicial })
    for (const e of dentro) {
      const t = Math.min(dur, Math.max(0, (e.timeSec - o.clipStartSec) / spb))
      const prev = pts[pts.length - 1]
      if (prev && Math.abs(prev.t - t) < EPS) prev.v = e.value
      else pts.push({ t, v: e.value })
    }
    if (pts.length === 0) continue
    // Un solo 0 inicial sin nada más no aporta.
    if (pts.length === 1 && pts[0]!.v === 0) continue
    if (pedal && pts[pts.length - 1]!.v > 0) {
      const tFin = Math.min(dur, Math.max(0, (hasta - o.clipStartSec) / spb))
      const prev = pts[pts.length - 1]!
      if (tFin <= prev.t + EPS) prev.v = 0
      else pts.push({ t: tFin, v: 0 })
    }
    lanes.push({
      cc,
      nombre: NOMBRES[cc] ?? `CC${cc}`,
      puntos: pts.map((p, i) => ({ id: `rec-cc${cc}-${i}`, tiempo: p.t, valor: p.v / 127, curva })),
    })
  }
  return lanes.sort((a, b) => a.cc - b.cc)
}

/**
 * valor del punto (contrato 0..1) → CC MIDI 0..127. Tolerancia solo para datos antiguos: un valor > 1 se
 * interpreta ya como 0..127 (un 1 exacto es siempre «máximo», nunca «CC = 1»).
 */
export function valorCcAMidi(valor: number): number {
  if (!Number.isFinite(valor)) return 0
  const v = valor > 1 ? valor : valor * 127
  return Math.max(0, Math.min(127, Math.round(v)))
}

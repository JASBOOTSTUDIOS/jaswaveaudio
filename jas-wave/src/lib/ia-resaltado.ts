/**
 * Resaltado de lo que la IA acaba de tocar: el asistente emite `jaswave-ia-toca` con {trackId, campos}
 * (ver plugins/com.jaswave.modulo.asistente-ia/src/motor/aviso-cambio-ia.ts) y el control correspondiente
 * (fader, paneo, mute, FX, envíos…) brilla un momento. Estado de sesión: no entra en el proyecto ni en el undo.
 */
import { useSyncExternalStore } from 'react'
import { preferenciasIA } from './preferencias-ia'

export const EVENTO_CAMBIO_IA = 'jaswave-ia-toca'
/** Cuánto dura el brillo tras el último cambio (ms). */
export const DURACION_RESALTADO_MS = 1600

const hasta = new Map<string, number>()
const oyentes = new Set<() => void>()
let temporizador: ReturnType<typeof setTimeout> | null = null
let version = 0

const clave = (trackId: string, campo: string) => `${trackId}\u0000${campo}`

function avisar(): void {
  version++
  for (const o of oyentes) o()
}

function programarLimpieza(ahora = Date.now()): void {
  if (temporizador) clearTimeout(temporizador)
  let proximo = Infinity
  for (const [k, t] of hasta) {
    if (t <= ahora) hasta.delete(k)
    else proximo = Math.min(proximo, t)
  }
  temporizador = Number.isFinite(proximo)
    ? setTimeout(() => {
        programarLimpieza()
        avisar()
      }, proximo - ahora + 10)
    : null
}

/** Marca controles como tocados por la IA (también lo usa el evento de ventana). */
export function marcarCambioIA(trackId: string, campos: readonly string[], ahora = Date.now()): void {
  if (!trackId || !campos.length) return
  // «Ver a la IA» apagado en el transporte: nada se ilumina.
  if (!preferenciasIA().ver) return
  for (const c of campos) hasta.set(clave(trackId, c), ahora + DURACION_RESALTADO_MS)
  // Cualquier cambio ilumina también la tira (para encontrarla de un vistazo).
  hasta.set(clave(trackId, '*'), ahora + DURACION_RESALTADO_MS)
  programarLimpieza(ahora)
  avisar()
}

export function estaResaltado(trackId: string, campo: string, ahora = Date.now()): boolean {
  return (hasta.get(clave(trackId, campo)) ?? 0) > ahora
}

let escuchando = false
function escucharVentana(): void {
  if (escuchando || typeof window === 'undefined') return
  escuchando = true
  window.addEventListener(EVENTO_CAMBIO_IA, (e) => {
    const d = (e as CustomEvent<{ trackId?: unknown; campos?: unknown }>).detail
    if (d && typeof d.trackId === 'string' && Array.isArray(d.campos)) marcarCambioIA(d.trackId, d.campos.map(String))
  })
}

function suscribir(fn: () => void): () => void {
  escucharVentana()
  oyentes.add(fn)
  return () => void oyentes.delete(fn)
}

/** ¿La IA acaba de tocar este control? (`campo`: volumen, paneo, mute, solo, fx, envios, notas o '*'). */
export function useResaltadoIA(trackId: string | undefined, campo: string): boolean {
  useSyncExternalStore(suscribir, () => version, () => 0)
  return trackId ? estaResaltado(trackId, campo) : false
}

/** ¿La IA acaba de tocar alguno de estos campos? (lista fija por control). */
export function useResaltadoIAAlguno(trackId: string | undefined, campos: readonly string[]): boolean {
  useSyncExternalStore(suscribir, () => version, () => 0)
  return trackId ? campos.some((c) => estaResaltado(trackId, c)) : false
}

/** Clases del brillo (anillo ámbar con halo) para un control tocado por la IA. */
export const CLASE_RESALTADO_IA = 'ring-2 ring-accent-amber shadow-[0_0_10px_2px_rgba(251,191,36,0.55)] transition-shadow'

/** Solo tests. */
export function _reiniciarResaltadoIA(): void {
  hasta.clear()
  if (temporizador) clearTimeout(temporizador)
  temporizador = null
}

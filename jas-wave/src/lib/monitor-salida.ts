/**
 * Monitorización: el volumen hacia los altavoces o la salida configurada. NO toca el master ni lo que se
 * exporta: el medidor del master sigue mostrando la señal aunque aquí esté a cero. Así se ve que la IA
 * está produciendo (hay señal) y, a la vez, que nada sale por la salida.
 *
 * Tres fuentes de silencio, independientes: el volumen del usuario, su botón de mute y el «silencio de la
 * IA» (con «Escuchar a la IA» apagado, la banda sigue sonando por dentro pero no sale). Estado de sesión
 * (localStorage), no del proyecto.
 */
import { useSyncExternalStore } from 'react'
import { audioEngine } from '@/lib/audio-engine'

const CLAVE = 'jaswave.monitor'
/** El asistente avisa si su trabajo debe salir o no por la salida: detail {silencio: boolean}. */
export const EVENTO_MONITOR_IA = 'jaswave-monitor-ia'

export type EstadoMonitor = { volumen: number; silenciado: boolean; silencioIA: boolean }

let estado: EstadoMonitor = leer()
const oyentes = new Set<() => void>()

function leer(): EstadoMonitor {
  try {
    const raw = localStorage.getItem(CLAVE)
    const o = raw ? (JSON.parse(raw) as Partial<EstadoMonitor>) : {}
    const v = Number(o.volumen)
    return { volumen: Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1, silenciado: o.silenciado === true, silencioIA: false }
  } catch {
    return { volumen: 1, silenciado: false, silencioIA: false }
  }
}

/** Ganancia que llega al dispositivo. */
export function gananciaMonitor(e: EstadoMonitor = estado): number {
  return e.silenciado || e.silencioIA ? 0 : e.volumen
}

function aplicar(): void {
  const gain = gananciaMonitor()
  const muted = gain === 0
  try {
    void window.electron?.pluginHostSend?.({ type: 'setMonitorMix', gain, muted })
  } catch {
    /* sin host (web) */
  }
  audioEngine.setMonitorGain(gain)
  for (const o of oyentes) o()
}

export function estadoMonitor(): EstadoMonitor {
  return estado
}

export function fijarMonitor(cambio: Partial<Pick<EstadoMonitor, 'volumen' | 'silenciado'>>): void {
  estado = {
    ...estado,
    ...(cambio.volumen != null ? { volumen: Math.max(0, Math.min(1, cambio.volumen)) } : {}),
    ...(cambio.silenciado != null ? { silenciado: cambio.silenciado } : {}),
  }
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ volumen: estado.volumen, silenciado: estado.silenciado }))
  } catch {
    /* sin almacenamiento */
  }
  aplicar()
}

/** La IA pide trabajar sin sacar audio (o vuelve a permitirlo). No se guarda: termina con su trabajo. */
export function fijarSilencioIA(silencio: boolean): void {
  if (estado.silencioIA === silencio) return
  estado = { ...estado, silencioIA: silencio }
  aplicar()
}

let escuchando = false
function suscribir(fn: () => void): () => void {
  if (!escuchando && typeof window !== 'undefined') {
    escuchando = true
    window.addEventListener(EVENTO_MONITOR_IA, (e) => {
      const d = (e as CustomEvent<{ silencio?: unknown }>).detail
      fijarSilencioIA(d?.silencio === true)
    })
    // Al abrir la app, el host recibe el volumen guardado.
    aplicar()
  }
  oyentes.add(fn)
  return () => void oyentes.delete(fn)
}

export function useMonitorSalida(): EstadoMonitor {
  return useSyncExternalStore(suscribir, () => estado, () => estado)
}

/** Solo tests. */
export function _reiniciarMonitor(): void {
  estado = { volumen: 1, silenciado: false, silencioIA: false }
}

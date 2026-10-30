/**
 * Preferencias de transporte del usuario (no del proyecto): se guardan en este equipo.
 * - detenerAlFinal: al terminar la canción se detiene y vuelve al inicio (por defecto sí).
 */

import { useSyncExternalStore } from 'react'

const CLAVE = 'jaswave-pref-transporte-v1'

export type PreferenciasTransporte = { detenerAlFinal: boolean }

const POR_DEFECTO: PreferenciasTransporte = { detenerAlFinal: true }

let actual: PreferenciasTransporte = leer()
const oyentes = new Set<() => void>()

function leer(): PreferenciasTransporte {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CLAVE) : null
    if (!raw) return { ...POR_DEFECTO }
    const j = JSON.parse(raw) as Partial<PreferenciasTransporte>
    return { detenerAlFinal: j.detenerAlFinal !== false }
  } catch {
    return { ...POR_DEFECTO }
  }
}

export function getPreferenciasTransporte(): PreferenciasTransporte {
  return actual
}

export function setDetenerAlFinal(valor: boolean): void {
  actual = { ...actual, detenerAlFinal: valor }
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actual))
  } catch {
    /* sin almacenamiento: vale para la sesión */
  }
  for (const o of oyentes) o()
}

function suscribir(o: () => void): () => void {
  oyentes.add(o)
  return () => oyentes.delete(o)
}

export function usePreferenciasTransporte(): PreferenciasTransporte {
  return useSyncExternalStore(suscribir, getPreferenciasTransporte, getPreferenciasTransporte)
}

/**
 * Qué percibe el usuario del trabajo de la IA (botones del transporte):
 *  - escuchar: suena lo que la IA va produciendo (cada parte grabada; la mezcla en bucle).
 *  - ver: se ilumina lo que la IA toca (faders, perillas, FX, cabeceras de pista).
 * Preferencia del usuario (no del proyecto). La comparte el módulo del asistente por las mismas claves y el
 * evento de ventana `jaswave-ia-preferencias` (ver plugins/…/asistente-ia/src/motor/escucha-en-vivo.ts).
 */
import { useSyncExternalStore } from 'react'

export const EVENTO_PREFERENCIAS_IA = 'jaswave-ia-preferencias'
export const CLAVE_ESCUCHAR_IA = 'jaswave.ia.escuchar'
export const CLAVE_VER_IA = 'jaswave.ia.ver'

export type PreferenciasIA = { escuchar: boolean; ver: boolean }

function leer(clave: string): boolean {
  try {
    return localStorage.getItem(clave) !== 'no'
  } catch {
    return true
  }
}

let actual: PreferenciasIA = { escuchar: leer(CLAVE_ESCUCHAR_IA), ver: leer(CLAVE_VER_IA) }
const oyentes = new Set<() => void>()
let escuchando = false

function releer(): void {
  const nuevo = { escuchar: leer(CLAVE_ESCUCHAR_IA), ver: leer(CLAVE_VER_IA) }
  if (nuevo.escuchar === actual.escuchar && nuevo.ver === actual.ver) return
  actual = nuevo
  for (const o of oyentes) o()
}

function escucharCambios(): void {
  if (escuchando || typeof window === 'undefined') return
  escuchando = true
  // El módulo del asistente también cambia «escuchar» (botón de la banda).
  window.addEventListener(EVENTO_PREFERENCIAS_IA, releer)
}

export function preferenciasIA(): PreferenciasIA {
  escucharCambios()
  return actual
}

export function fijarPreferenciaIA(cambio: Partial<PreferenciasIA>): void {
  try {
    if (cambio.escuchar != null) localStorage.setItem(CLAVE_ESCUCHAR_IA, cambio.escuchar ? 'si' : 'no')
    if (cambio.ver != null) localStorage.setItem(CLAVE_VER_IA, cambio.ver ? 'si' : 'no')
  } catch {
    /* sin almacenamiento: solo esta sesión */
  }
  actual = { ...actual, ...cambio }
  for (const o of oyentes) o()
  try {
    window.dispatchEvent(new Event(EVENTO_PREFERENCIAS_IA))
  } catch {
    /* sin ventana (tests) */
  }
}

export function usePreferenciasIA(): PreferenciasIA {
  return useSyncExternalStore(
    (cb) => {
      escucharCambios()
      oyentes.add(cb)
      return () => void oyentes.delete(cb)
    },
    () => actual,
    () => actual,
  )
}

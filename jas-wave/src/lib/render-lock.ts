/**
 * Bloqueo global de render (U6).
 *
 * Durante un bounce el transporte, la edición y los atajos quedan
 * deshabilitados: solo se permite cancelar el render. El bloqueo vive fuera
 * del estado del proyecto porque es una condición de la sesión de la UI, no
 * una propiedad del proyecto (no se guarda en disco ni entra en el undo).
 */

import { useSyncExternalStore } from 'react'

let bloqueado = false
const oyentes = new Set<(b: boolean) => void>()

/** ¿Hay un render en curso? */
export function estaRenderLock(): boolean {
  return bloqueado
}

/** Bloquea la app (transporte, edición y atajos). */
export function activarRenderLock(): void {
  if (bloqueado) return
  bloqueado = true
  for (const o of oyentes) o(true)
}

/** Desbloquea la app. */
export function desactivarRenderLock(): void {
  if (!bloqueado) return
  bloqueado = false
  for (const o of oyentes) o(false)
}

/** Suscripción al cambio del bloqueo. */
export function suscribirRenderLock(fn: (b: boolean) => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/** Hook para leer el bloqueo en componentes React. */
export function useRenderLock(): boolean {
  return useSyncExternalStore(
    (cb) => suscribirRenderLock(() => cb()),
    () => bloqueado,
    () => false,
  )
}

/** Solo tests: limpia el estado del módulo. */
export function _reiniciarRenderLock(): void {
  bloqueado = false
  oyentes.clear()
}

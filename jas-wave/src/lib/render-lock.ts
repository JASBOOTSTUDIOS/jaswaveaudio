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
/**
 * Renders en curso. Es un contador, no un interruptor: con varias mediciones a la vez (la IA mide mientras otro
 * agente exporta) el primero que termina desbloqueaba la app en pleno render del segundo.
 */
let rendersEnCurso = 0
const oyentes = new Set<(b: boolean) => void>()

/** ¿Hay un render en curso? */
export function estaRenderLock(): boolean {
  return bloqueado
}

/** Bloquea la app (transporte, edición y atajos). Cada llamada se empareja con un `desactivarRenderLock`. */
export function activarRenderLock(): void {
  rendersEnCurso++
  if (bloqueado) return
  bloqueado = true
  for (const o of oyentes) o(true)
}

/** Libera un render; la app se desbloquea cuando ya no queda ninguno. */
export function desactivarRenderLock(): void {
  if (rendersEnCurso > 0) rendersEnCurso--
  if (!bloqueado || rendersEnCurso > 0) return
  bloqueado = false
  for (const o of oyentes) o(false)
}

/** Resuelve cuando no hay ningún render en curso; false si se agota el tiempo (p. ej. un render colgado). */
export function esperarFinDeRender(maxMs: number): Promise<boolean> {
  if (!bloqueado) return Promise.resolve(true)
  return new Promise((resolve) => {
    let fin = false
    const cerrar = (ok: boolean) => {
      if (fin) return
      fin = true
      clearTimeout(t)
      off()
      resolve(ok)
    }
    const off = suscribirRenderLock((b) => {
      if (!b) cerrar(true)
    })
    const t = setTimeout(() => cerrar(!bloqueado), maxMs)
  })
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
  rendersEnCurso = 0
  oyentes.clear()
}

/**
 * Prefijos de comando que no se pueden ejecutar durante un bounce: cualquier
 * cambio de la línea de tiempo, del grafo de audio o del transporte.
 * Se permiten `render.*` (arrancar/cancelar el bounce), `analysis.*`, `ui.*`,
 * `selection.*` y `atajos.*`.
 */
const PREFIJOS_BLOQUEADOS_DURANTE_RENDER = [
  'automation.',
  'bus.',
  'clip.',
  'fxChain.',
  'marker.',
  'midi.',
  'plugin.',
  'project.',
  'send.',
  'sidechain.',
  'take.',
  'track.',
  'transport.',
]

/** Comandos de proyecto que sí se pueden ejecutar durante un bounce. */
const COMANDOS_PROYECTO_PERMITIDOS = new Set(['project.save'])

/** ¿Este comando edita la línea de tiempo, el audio o el transporte? */
export function comandoBloqueadoDuranteRender(tipo: string): boolean {
  if (!tipo) return false
  if (tipo.startsWith('render.') || tipo.startsWith('analysis.')) return false
  if (tipo.startsWith('ui.') || tipo.startsWith('selection.') || tipo.startsWith('atajos.')) return false
  if (COMANDOS_PROYECTO_PERMITIDOS.has(tipo)) return false
  return PREFIJOS_BLOQUEADOS_DURANTE_RENDER.some((p) => tipo.startsWith(p))
}

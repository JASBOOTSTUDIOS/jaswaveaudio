/**
 * Identificadores de gesto para la coalescencia de undo del executor
 * (`execute(..., { coalesceKey, gestureId })`): todos los comandos de un mismo
 * gesto (arrastre de fader, giro de rueda, flechas repetidas) se fusionan en
 * una sola entrada de undo.
 */

import type { OpcionesEjecucion } from '../../../shared/src/types/command'

let contador = 0

/** Id único de gesto (se genera en pointerdown y vale hasta pointerup). */
export function nuevoGestureId(prefijo = 'g'): string {
  contador += 1
  return `${prefijo}-${Date.now().toString(36)}-${contador}`
}

/**
 * Gesto por ventana temporal: devuelve el mismo id mientras las llamadas lleguen
 * con menos de `ventanaMs` entre sí (rueda del ratón, teclas repetidas).
 */
export function crearVentanaGesto(ventanaMs = 600, ahora: () => number = Date.now): () => string {
  let id = ''
  let ultima = -Infinity
  return () => {
    const t = ahora()
    if (!id || t - ultima > ventanaMs) id = nuevoGestureId('w')
    ultima = t
    return id
  }
}

/** Opciones de ejecución para un control continuo; sin gesto → entrada normal. */
export function opcionesGesto(coalesceKey: string, gestureId?: string): OpcionesEjecucion | undefined {
  return gestureId ? { coalesceKey, gestureId } : undefined
}

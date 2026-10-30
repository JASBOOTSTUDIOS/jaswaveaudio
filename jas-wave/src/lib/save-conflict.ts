/**
 * Diálogo de conflicto por cambio en disco (U7).
 *
 * Cuando el `.jaswave` cambió fuera de JasWave, el guardado se detiene y se
 * pregunta: Sobrescribir / Guardar como / Cancelar. Nunca se pisa el archivo
 * sin preguntar.
 */

import { mensajeConflictoDisco, type ConflictoDisco, type EleccionConflicto } from '../../../shared/src/project/conflicto-disco'

export type { ConflictoDisco, EleccionConflicto }

type Pendiente = {
  conflicto: ConflictoDisco
  promesa: Promise<EleccionConflicto>
  resolver: (e: EleccionConflicto) => void
}

let pendiente: Pendiente | null = null
const oyentes = new Set<() => void>()

function notificar(): void {
  for (const fn of [...oyentes]) {
    try {
      fn()
    } catch {
      /* un oyente roto no bloquea a los demás */
    }
  }
}

/** Conflicto a resolver (o null). */
export function obtenerConflictoPendiente(): ConflictoDisco | null {
  return pendiente?.conflicto ?? null
}

export function suscribirConflicto(fn: () => void): () => void {
  oyentes.add(fn)
  return () => {
    oyentes.delete(fn)
  }
}

/** Pide la decisión del usuario. Si ya hay una pregunta abierta, devuelve la misma promesa. */
export function solicitarDecisionConflicto(conflicto: ConflictoDisco): Promise<EleccionConflicto> {
  if (pendiente) return pendiente.promesa
  let resolver!: (e: EleccionConflicto) => void
  const promesa = new Promise<EleccionConflicto>((r) => {
    resolver = r
  })
  pendiente = { conflicto, promesa, resolver }
  notificar()
  return promesa
}

/** Respuesta del diálogo. Sin conflicto abierto no hace nada. */
export function responderConflicto(eleccion: EleccionConflicto): void {
  const p = pendiente
  if (!p) return
  pendiente = null
  notificar()
  p.resolver(eleccion)
}

export { mensajeConflictoDisco }

/** Solo tests: limpia el estado del módulo. */
export function _reiniciarConflicto(): void {
  pendiente = null
  oyentes.clear()
}

/**
 * Registro de habilidades ejecutables. El turno del agente consulta `elegirHabilidad` antes de
 * razonar: si un pedido coincide, se resuelve con una sola llamada creativa + herramientas
 * deterministas, en lugar de dejar a un modelo pequeño improvisar el encadenado de herramientas.
 */

import { habilidadCompletarCancion } from './completar-cancion'
import type { ContextoHabilidad, Habilidad } from './tipos'

export const HABILIDADES: readonly Habilidad[] = [habilidadCompletarCancion]

export const UMBRAL_HABILIDAD = 0.6

export function elegirHabilidad(ctx: ContextoHabilidad, habilidades: readonly Habilidad[] = HABILIDADES): Habilidad | null {
  let mejor: Habilidad | null = null
  let puntos = 0
  for (const h of habilidades) {
    const p = h.coincide(ctx)
    if (p > puntos) {
      puntos = p
      mejor = h
    }
  }
  return puntos >= UMBRAL_HABILIDAD ? mejor : null
}

export { habilidadCompletarCancion, coincideCompletarCancion, resumirProyectoParaCancion, validarBriefCancion } from './completar-cancion'
export type { BriefCancion, ResumenProyectoCancion } from './completar-cancion'
export {
  MARCADORES_DAW,
  VERSION_PROCEDIMIENTO,
  coincideProcedimiento,
  compilarHabilidad,
  compilarHabilidadLocal,
  esProcedimientoHabilidad,
  habilidadDesdeProcedimiento,
  instruccionesCompactasProcedimiento,
  mensajesCompilarHabilidad,
  preseleccionarHerramientas,
  validarProcedimiento,
} from './personalizada'
export type {
  HerramientaCatalogo,
  OpcionesValidacion,
  PasoProcedimiento,
  ProcedimientoHabilidad,
  ResultadoCompilacion,
  ResultadoValidacion,
  SiSinDatos,
  TipoVariable,
  VariableProcedimiento,
} from './personalizada'
export { extraerJson } from './tipos'
export type { ContextoHabilidad, Habilidad, MensajeBrief, PlanHabilidad } from './tipos'

/**
 * Capacidades por modo (tabla de A3) que el motor aplica como guarda real en el bucle nativo.
 *
 * | Modo   | Herramientas                         | Muta       | Plan aprobado        |
 * |--------|--------------------------------------|------------|----------------------|
 * | ask    | lectura + análisis + auditoría        | No         | —                    |
 * | think  | lectura + análisis                    | No         | —                    |
 * | plan   | lectura + análisis + `plan.*`         | Solo plan  | —                    |
 * | create | todas según política                  | Sí         | Requerido (pide 1 vez) |
 * | auto   | todas según política                  | Sí         | Auto-aprobado        |
 *
 * Destructivas/sistema siempre confirman en los modos que mutan (action-policy).
 * A3 ampliará esta tabla (flujo de fin de turno, sugerencias de modo, prompts por modo).
 */

import type { AgentActionClass } from '../agent/action-policy'
import type { EngineMode } from './engine-types'

export type ModeEndOfTurn = 'answer' | 'diagnosis' | 'plan-approval' | 'execute'

export type ModeCapabilities = {
  mode: EngineMode
  /** Puede ejecutar herramientas `write` (además de lecturas). */
  canMutate: boolean
  /** Solo puede escribir el plan (`plan.*`). */
  planWritesOnly: boolean
  /** Necesita plan aprobado antes de la primera mutación. */
  requiresApprovedPlan: boolean
  /** Aprueba el plan solo (auto). */
  autoApprovePlan: boolean
  endOfTurn: ModeEndOfTurn
}

export const MODE_CAPABILITIES: Readonly<Record<EngineMode, ModeCapabilities>> = Object.freeze({
  ask: { mode: 'ask', canMutate: false, planWritesOnly: false, requiresApprovedPlan: false, autoApprovePlan: false, endOfTurn: 'answer' },
  think: { mode: 'think', canMutate: false, planWritesOnly: false, requiresApprovedPlan: false, autoApprovePlan: false, endOfTurn: 'diagnosis' },
  plan: { mode: 'plan', canMutate: false, planWritesOnly: true, requiresApprovedPlan: false, autoApprovePlan: false, endOfTurn: 'plan-approval' },
  create: { mode: 'create', canMutate: true, planWritesOnly: false, requiresApprovedPlan: true, autoApprovePlan: false, endOfTurn: 'execute' },
  auto: { mode: 'auto', canMutate: true, planWritesOnly: false, requiresApprovedPlan: false, autoApprovePlan: true, endOfTurn: 'execute' },
})

export function modeCapabilities(mode: EngineMode): ModeCapabilities {
  return MODE_CAPABILITIES[mode] ?? MODE_CAPABILITIES.ask
}

export function isPlanToolName(name: string): boolean {
  return name.startsWith('plan.')
}

export type ModeToolGate =
  | { allow: true; needs?: 'confirm' | 'approve-plan' }
  | { allow: false; message: string }

/**
 * Decide si un modo permite una llamada (fail closed: sin clase → bloqueada).
 * `planApproved` solo importa en modos que lo requieren.
 */
export function gateToolForMode(
  caps: ModeCapabilities,
  name: string,
  cls: AgentActionClass | undefined,
  opts: { planApproved: boolean },
): ModeToolGate {
  if (cls === undefined) {
    return { allow: false, message: `Bloqueada: ${name} no tiene clase de riesgo conocida (fail closed).` }
  }
  if (cls === 'read') return { allow: true }
  if (!caps.canMutate) {
    if (caps.planWritesOnly && isPlanToolName(name) && cls === 'write') return { allow: true }
    return {
      allow: false,
      message: `El modo «${caps.mode}» no modifica el proyecto: ${name} rechazada. Responde con lo que sabes o sugiere cambiar a Crear.`,
    }
  }
  if (cls === 'destructive' || cls === 'system') return { allow: true, needs: 'confirm' }
  if (caps.requiresApprovedPlan && !opts.planApproved && !caps.autoApprovePlan) {
    return { allow: true, needs: 'approve-plan' }
  }
  return { allow: true }
}

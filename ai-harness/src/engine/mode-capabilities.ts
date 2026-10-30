/**
 * Capacidades por modo (tabla de A3) que el motor aplica como guarda real en el bucle nativo.
 *
 * | Modo   | Herramientas                         | Muta       | Plan aprobado        |
 * |--------|--------------------------------------|------------|----------------------|
 * | ask    | lectura + análisis + auditoría        | No         | —                    |
 * | think  | lectura + análisis                    | No         | —                    |
 * | plan   | lectura + análisis + plan (`plan.md`) | Solo plan  | —                    |
 * | create | todas según política                  | Sí         | Requerido (pide 1 vez) |
 * | auto   | todas según política                  | Sí         | Auto-aprobado        |
 *
 * Destructivas/sistema siempre confirman en los modos que mutan (action-policy).
 */

import type { AgentActionClass } from '../agent/action-policy'
import type { EngineMode } from './engine-types'

export type ModeEndOfTurn = 'answer' | 'diagnosis' | 'plan-approval' | 'execute'

export type ModeCapabilities = {
  mode: EngineMode
  /** Puede ejecutar herramientas `write` (además de lecturas). */
  canMutate: boolean
  /** Solo puede escribir el plan (`plan.*` o doc sobre plan.md). */
  planWritesOnly: boolean
  /** Necesita plan aprobado antes de la primera mutación. */
  requiresApprovedPlan: boolean
  /** Aprueba el plan solo (auto). */
  autoApprovePlan: boolean
  /** Clases de acción permitidas (fail closed: no listada → bloqueada). */
  allowedClasses: ReadonlySet<AgentActionClass>
  endOfTurn: ModeEndOfTurn
}

const READ_ONLY_CLASSES: ReadonlySet<AgentActionClass> = new Set<AgentActionClass>(['read'])
const MUTATING_CLASSES: ReadonlySet<AgentActionClass> = new Set<AgentActionClass>(['read', 'write'])

export const MODE_CAPABILITIES: Readonly<Record<EngineMode, ModeCapabilities>> = Object.freeze({
  ask: {
    mode: 'ask',
    canMutate: false,
    planWritesOnly: false,
    requiresApprovedPlan: false,
    autoApprovePlan: false,
    allowedClasses: READ_ONLY_CLASSES,
    endOfTurn: 'answer',
  },
  think: {
    mode: 'think',
    canMutate: false,
    planWritesOnly: false,
    requiresApprovedPlan: false,
    autoApprovePlan: false,
    allowedClasses: READ_ONLY_CLASSES,
    endOfTurn: 'diagnosis',
  },
  plan: {
    mode: 'plan',
    canMutate: false,
    planWritesOnly: true,
    requiresApprovedPlan: false,
    autoApprovePlan: false,
    allowedClasses: READ_ONLY_CLASSES,
    endOfTurn: 'plan-approval',
  },
  create: {
    mode: 'create',
    canMutate: true,
    planWritesOnly: false,
    requiresApprovedPlan: true,
    autoApprovePlan: false,
    allowedClasses: MUTATING_CLASSES,
    endOfTurn: 'execute',
  },
  auto: {
    mode: 'auto',
    canMutate: true,
    planWritesOnly: false,
    requiresApprovedPlan: false,
    autoApprovePlan: true,
    allowedClasses: MUTATING_CLASSES,
    endOfTurn: 'execute',
  },
})

export function modeCapabilities(mode: EngineMode): ModeCapabilities {
  return MODE_CAPABILITIES[mode] ?? MODE_CAPABILITIES.ask
}

export function isPlanToolName(name: string): boolean {
  return name.startsWith('plan.')
}

/**
 * Escrituras de plan: herramientas `plan.*` o `doc.write`/`doc.append` sobre `plan.md`
 * (el plan estructurado vive en ese slug; A4 lo convierte en la fuente de verdad).
 */
export function isPlanWriteTool(name: string, args?: Record<string, unknown> | undefined): boolean {
  if (isPlanToolName(name)) return true
  if (name === 'doc.write' || name === 'doc.append') {
    const slug = args?.slug
    return typeof slug === 'string' && /(^|\/)plan\.md$/i.test(slug.trim())
  }
  return false
}

/** ¿Se ve una herramienta en la lista de tools del modo? (sin args solo decide por nombre). */
export function visibleInMode(
  caps: ModeCapabilities,
  name: string,
  cls: AgentActionClass | undefined,
): boolean {
  if (cls === undefined) return false
  if (cls === 'read') return true
  if (cls === 'write') {
    // Sin args no se puede saber el slug: doc.write/doc.append se ofertan en modos que
    // admiten escribir el plan; el gate rechaza los que no apuntan a plan.md.
    if (name.startsWith('plan.') || name === 'doc.write' || name === 'doc.append') {
      return caps.mode !== 'ask' && caps.mode !== 'think'
    }
    return caps.canMutate
  }
  return caps.canMutate
}

export type ModeToolGate =
  | { allow: true; needs?: 'confirm' | 'approve-plan' }
  | { allow: false; message: string }

function deny(mode: EngineMode, name: string): ModeToolGate {
  return {
    allow: false,
    message: `El modo «${mode}» no modifica el proyecto: ${name} rechazada. Responde con lo que sabes o sugiere cambiar a Crear.`,
  }
}

/**
 * Decide si un modo permite una llamada (fail closed: sin clase → bloqueada).
 * `planApproved` solo importa en modos que lo requieren; `args` decide si una
 * escritura de doc es realmente una escritura de plan.
 */
export function gateToolForMode(
  caps: ModeCapabilities,
  name: string,
  cls: AgentActionClass | undefined,
  opts: { planApproved: boolean; args?: Record<string, unknown> | undefined },
): ModeToolGate {
  if (cls === undefined) {
    return { allow: false, message: `Bloqueada: ${name} no tiene clase de riesgo conocida (fail closed).` }
  }
  if (cls === 'read') return { allow: true }
  if (cls === 'destructive' || cls === 'system') {
    if (!caps.canMutate) return deny(caps.mode, name)
    return { allow: true, needs: 'confirm' }
  }
  // write
  if (isPlanWriteTool(name, opts.args)) {
    if (caps.mode === 'ask' || caps.mode === 'think') return deny(caps.mode, name)
    return { allow: true }
  }
  if (!caps.canMutate) return deny(caps.mode, name)
  if (caps.requiresApprovedPlan && !opts.planApproved && !caps.autoApprovePlan) {
    return { allow: true, needs: 'approve-plan' }
  }
  return { allow: true }
}

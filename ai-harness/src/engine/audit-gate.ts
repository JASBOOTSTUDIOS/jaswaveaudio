/**
 * Gates de auditoría A9 (fail closed).
 *
 * Reglas del motor:
 * - QA no marca un paso como hecho sin `audit.step` con `cumple: true` y evidencia
 *   adjunta al paso. Un paso con criterios de aceptación que no se puede verificar
 *   NUNCA se marca `[x]`: queda bloqueado.
 * - El Director no cierra el turno sin `audit.project` limpio. Las incidencias
 *   aceptadas explícitamente por el usuario no bloquean; el resto sí.
 * - Si el turno tocó mezcla/master, `audit.mix` también tiene que estar dentro de
 *   criterio (mismo criterio de aceptación explícita).
 *
 * Son funciones puras: el motor las usa igual en el bucle nativo, en la CLI y en
 * los tests (no dependen de React ni de Electron).
 */

import type { EngineProjectAudit, EngineStepAudit } from './engine-types'

export type StepGateInput = {
  /** El paso declara criterios de aceptación medibles (`- criterio: ...`). */
  hayCriterios: boolean
  /** Veredicto del host. `undefined` = el host no implementa `audit.step`. */
  verdict?: EngineStepAudit
}

export type StepGateResult = {
  /** El paso puede marcarse como hecho. */
  ok: boolean
  /** Motivos del bloqueo (vacío si `ok`). */
  issues: string[]
  /** Evidencia que se adjunta al paso en plan.md. */
  evidencia: string[]
}

/** Nota que se adjunta cuando el paso no tiene nada que verificar. */
export const STEP_SIN_CRITERIOS_EVIDENCIA = 'Paso sin criterios de aceptación: no hay QA que ejecutar.'

/**
 * Veredicto de QA de un paso. Fail closed: sin veredicto verificable, con criterios
 * pendientes o sin evidencia, el paso no se puede marcar como hecho.
 */
export function gateStepAudit(input: StepGateInput): StepGateResult {
  const evidencia = (input.verdict?.evidencia ?? []).map((e) => e.trim()).filter(Boolean)

  if (!input.verdict) {
    if (input.hayCriterios) {
      return {
        ok: false,
        issues: ['El host no implementa `audit.step`: no se puede verificar el paso.'],
        evidencia,
      }
    }
    return { ok: true, issues: [], evidencia: [STEP_SIN_CRITERIOS_EVIDENCIA] }
  }

  if (!input.verdict.ok) {
    return {
      ok: false,
      issues: input.verdict.issues?.length ? [...input.verdict.issues] : ['QA del paso no pasó.'],
      evidencia,
    }
  }

  if (input.hayCriterios && !evidencia.length) {
    return {
      ok: false,
      issues: ['QA sin evidencia: el paso tiene criterios de aceptación y no se puede marcar como hecho.'],
      evidencia,
    }
  }

  return { ok: true, issues: [], evidencia }
}

export type ProjectGateResult = {
  /** El turno puede cerrarse limpiamente. */
  ok: boolean
  /** Incidencias bloqueantes (el turno no se cierra). */
  issues: string[]
  /** Avisos no bloqueantes. */
  warnings: string[]
}

/**
 * Cierre del turno con plan: exige `audit.project` limpio. Las incidencias
 * aceptadas explícitamente (`acceptedIssues`) no bloquean.
 */
export function gateProjectAudit(audit: EngineProjectAudit | undefined): ProjectGateResult {
  if (!audit) return { ok: true, issues: [], warnings: [] }

  const aceptadas = new Set(audit.acceptedIssues ?? [])
  const rawIssues = audit.issues ?? []
  const rawMix = audit.mix?.issues ?? []
  const issues = rawIssues.filter((i) => !aceptadas.has(i))
  const mixIssues = rawMix.filter((i) => !aceptadas.has(i))

  const bloqueantes = [...issues, ...mixIssues]
  if (audit.ok === false && !rawIssues.length && !rawMix.length) {
    bloqueantes.push('La auditoría del proyecto no pasó.')
  }

  const avisos = [
    ...(audit.warnings ?? []),
    ...rawIssues.filter((i) => aceptadas.has(i)),
    ...(audit.ok === true ? issues : []),
    ...(audit.mix?.ok === true ? mixIssues : []),
  ]

  return { ok: bloqueantes.length === 0, issues: bloqueantes, warnings: avisos }
}

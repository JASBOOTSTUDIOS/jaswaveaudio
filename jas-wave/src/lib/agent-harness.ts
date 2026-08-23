/**
 * Segundo turno del agente: juicio de intención vs plan vs DAW (un solo pase).
 */

import { getAgentDoc, PLAN_SLUG } from './agent-docs'
import type { PlanEvaluation } from './agent-plan-eval'
import type { ActionResult } from './ai-daw-agent'

const READ_ONLY = new Set(['doc.list', 'doc.read', 'doc.evaluate'])

export function harnessReviewNeeded(results: ActionResult[]): boolean {
  return results.some((r) => r.success && !READ_ONLY.has(r.type))
}

export function buildHarnessReviewMessage(opts: {
  userText: string
  evalSummary: string
  actionsSummary: string
  projectId: string
  evaluation: PlanEvaluation | null
}): string {
  const plan = getAgentDoc(opts.projectId, PLAN_SLUG)
  const missing = opts.evaluation?.missing ?? []
  const planned = opts.evaluation?.planned ?? 0
  const done = opts.evaluation?.done ?? 0
  return [
    '## Turno de revisión del harness (un solo pase, obligatorio)',
    `Pedido original del usuario:\n${opts.userText}`,
    '',
    'Contrasta estas tres capas y actualiza plan.md:',
    '1) Intención — qué se quería producir (sección Intención y el pedido).',
    '2) Por implementar — tareas del plan, incluidas las que el USUARIO haya editado.',
    '3) Implementado — pistas, plugins y clips que hay AHORA en el DAW.',
    '',
    `Evaluación mecánica: ${opts.evalSummary || '(sin eval automática)'}`,
    `Cobertura checkbox: ${done}/${planned}. Falta: ${missing.join('; ') || 'nada'}`,
    opts.evaluation?.extraTracks.length
      ? `Pistas extra en el DAW: ${opts.evaluation.extraTracks.join(', ')}`
      : '',
    '',
    'Acciones ya ejecutadas:',
    opts.actionsSummary || '(ninguna)',
    '',
    '### plan.md actual (respeta «Notas del usuario»)',
    plan?.content ?? '(no hay plan.md)',
    '',
    'Responde 2-4 frases en español con tu juicio (qué coincidió, qué falta, si el resultado es musicalmente coherente con la intención).',
    'Actualiza plan.md con <<<DOC plan.md ... DOC>>> o doc.write / doc.evaluate:',
    '- ## Evaluación: tu juicio (no copies solo la tabla mecánica)',
    '- ## Implementado / ## Por implementar / ## En curso',
    'Si falta algo concreto y puedes crearlo ahora, un bloque ACTIONS (un ajuste, no rehacer el proyecto). Si el usuario debe decidir, déjalo pendiente en el plan.',
    'NO pises la sección «Notas del usuario». NO repitas las acciones que ya salieron bien.',
  ]
    .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
    .join('\n')
}

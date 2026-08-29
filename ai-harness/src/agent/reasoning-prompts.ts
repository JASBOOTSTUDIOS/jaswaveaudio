/**
 * Plantillas de prompt por fase del bucle de razonamiento profundo.
 */

import type { AgentMode } from './modes'
import { modePromptBlock } from './modes'

export type ReasoningPhase =
  | 'think1'
  | 'research1'
  | 'think2'
  | 'research2'
  | 'analysis'
  | 'decision'

export const REASONING_PHASE_META: Record<
  ReasoningPhase,
  { title: string; maxTokensHint: number }
> = {
  think1: { title: 'Pensamiento 1 — analizar intención', maxTokensHint: 2048 },
  research1: { title: 'Investigación 1 — contexto y consultas', maxTokensHint: 3072 },
  think2: { title: 'Pensamiento 2 — reflexionar hallazgos', maxTokensHint: 2048 },
  research2: { title: 'Investigación 2 — cerrar brechas', maxTokensHint: 3072 },
  analysis: { title: 'Análisis — consolidar', maxTokensHint: 2048 },
  decision: { title: 'Decisión — estrategia final', maxTokensHint: 4096 },
}

const READ_TOOLS_HELP = [
  'Herramientas read-only disponibles en investigación (bloque <<<READ … READ>>>):',
  '- doc.list | doc.read { slug }',
  '- library.preset.list | library.preset.search { query?, rol?, genero? }',
  '- plugin.lookup { nombre } | plugin.probe { pluginId? | path? | nombre? }',
  '- analysis.buffer { sampleMs? } | analysis.timing | track.getFxChain { trackId }',
  '- web.search { query } — búsqueda web cuando no conozcas algo',
  'Formato:',
  '<<<READ',
  '[{"type":"doc.read","payload":{"slug":"plan.md"}}]',
  'READ>>>',
  'Máximo 4 acciones por fase de investigación. NO uses acciones que muten el DAW.',
].join('\n')

export function reasoningSystemPreamble(mode: AgentMode): string {
  return [
    'Eres el coproductor de JasWave (DAW). Trabajas en un bucle de razonamiento profundo antes de actuar.',
    'Responde en español. Este turno interno NO es visible tal cual al usuario — sé exhaustivo.',
    modePromptBlock(mode === 'auto' ? 'create' : mode),
    '',
    READ_TOOLS_HELP,
  ].join('\n')
}

export function promptForPhase(
  phase: ReasoningPhase,
  opts: {
    userText: string
    mode: AgentMode
    projectContext: string
    priorSteps: string
    toolResults?: string
  },
): string {
  const base = [
    '## Contexto del proyecto (solo lectura)',
    opts.projectContext.slice(0, 12000),
    '',
    '## Pedido del usuario',
    opts.userText,
    '',
  ]

  if (opts.priorSteps) {
    base.push('## Pasos previos del razonamiento', opts.priorSteps, '')
  }
  if (opts.toolResults) {
    base.push('## Resultados de herramientas', opts.toolResults, '')
  }

  switch (phase) {
    case 'think1':
      return [
        ...base,
        '## Tu tarea (Pensamiento 1)',
        'Analiza en profundidad qué pide el usuario. ¿Es sobre el proyecto actual, teoría musical, audio, VST, plan?',
        'Identifica qué información falta en el contexto. Enumera preguntas abiertas y qué deberías consultar.',
        'NO emitas ACTIONS ni READ todavía — solo razonamiento estructurado.',
      ].join('\n')

    case 'research1':
      return [
        ...base,
        '## Tu tarea (Investigación 1)',
        'Con base en el pensamiento anterior, sintetiza qué necesitas saber.',
        'Si hace falta más contexto del proyecto o web, emite <<<READ […] READ>>> con acciones read-only.',
        'Si ya tienes suficiente, explica qué sabes y qué falta — sin READ.',
      ].join('\n')

    case 'think2':
      return [
        ...base,
        '## Tu tarea (Pensamiento 2)',
        'Reflexiona sobre lo investigado. ¿Quedan brechas? ¿Contradicciones con el DAW real?',
        'Prioriza riesgos (audio, VST, plan incompleto). NO READ — solo análisis crítico.',
      ].join('\n')

    case 'research2':
      return [
        ...base,
        '## Tu tarea (Investigación 2)',
        'Cierra brechas restantes. Solo si hace falta, emite <<<READ […] READ>>>.',
        'Si ya está completo, resume el contexto acumulado listo para decidir.',
      ].join('\n')

    case 'analysis':
      return [
        ...base,
        '## Tu tarea (Análisis)',
        'Consolida: intención del usuario, hechos del proyecto, hallazgos, riesgos y criterios de éxito.',
        'Lista explícita de lo que harás o responderás en el turno final.',
      ].join('\n')

    case 'decision':
      return [
        ...base,
        '## Tu tarea (Decisión)',
        'Emite un brief ejecutivo para el turno final (visible al usuario):',
        '- Estrategia en 3-6 bullets',
        '- Acciones DAW propuestas (tipos, sin JSON largo) o respuesta consultiva',
        '- Advertencias al usuario si las hay',
        'Este texto se pasará al modelo que genera la respuesta final y ACTIONS.',
      ].join('\n')
  }
}

export function buildFinalTurnUserMessage(opts: {
  userText: string
  decisionBrief: string
  stepsSummary: string
}): string {
  return [
    '## Razonamiento profundo completado',
    opts.stepsSummary,
    '',
    '## Brief de decisión',
    opts.decisionBrief,
    '',
    '## Pedido original del usuario',
    opts.userText,
    '',
    'Genera ahora la respuesta visible al usuario (1-3 frases en español) y, si corresponde al modo, el bloque <<<ACTIONS … ACTIONS>>> / <<<PLAN … PLAN>>> / <<<DOC … DOC>>>.',
  ].join('\n')
}

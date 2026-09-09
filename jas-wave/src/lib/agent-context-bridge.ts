/**
 * Context L4-L5 + Memory Manager + reglas de proyecto para el coproducer.
 */

import type { DAWState } from '../../../shared/src/types/state'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import { buildReadOnlyProjectContext } from './ai-read-context'
import { getAgentDoc, PLAN_SLUG } from './agent-docs'

export type SessionRules = {
  genre?: string
  targetLufs?: number
  allowedPlugins?: string[]
  notes?: string
}

const SESSION_RULES_KEY = 'jaswave.sessionRules'

export function loadSessionRules(projectId: string): SessionRules {
  try {
    const raw = localStorage.getItem(`${SESSION_RULES_KEY}:${projectId}`)
    return raw ? (JSON.parse(raw) as SessionRules) : {}
  } catch {
    return {}
  }
}

export function saveSessionRules(projectId: string, rules: SessionRules): void {
  localStorage.setItem(`${SESSION_RULES_KEY}:${projectId}`, JSON.stringify(rules))
}

export function formatSessionRulesBlock(rules: SessionRules): string {
  const lines: string[] = []
  if (rules.genre) lines.push(`- Género objetivo: ${rules.genre}`)
  if (typeof rules.targetLufs === 'number') lines.push(`- Target LUFS: ${rules.targetLufs}`)
  if (rules.allowedPlugins?.length) lines.push(`- Plugins permitidos: ${rules.allowedPlugins.join(', ')}`)
  if (rules.notes) lines.push(`- Notas: ${rules.notes}`)
  return lines.length ? ['## Reglas de sesión', ...lines].join('\n') : ''
}

export function startCoproducerSession(tienda: TiendaDAW): void {
  tienda.iniciarSesionIA()
}

export function endCoproducerSession(tienda: TiendaDAW): void {
  tienda.finalizarSesionIA()
}

export function buildAssembledAgentContext(
  tienda: TiendaDAW,
  state: DAWState,
  userText: string,
  chatTurns: Array<{ role: 'user' | 'assistant'; content: string }>,
  libraryPresetsBlock?: string,
): string {
  const projectId = state.project?.id ?? 'default'
  const plan = getAgentDoc(projectId, PLAN_SLUG)
  const rules = loadSessionRules(projectId)

  const selectedId = state.selection?.idsPistas?.[0]
  const assembled = tienda.ensamblarContexto(
    {
      userIntent: userText,
      selectedTrackId: selectedId,
      selectedClipId: state.selection?.idsClips?.[0],
    },
    chatTurns.slice(-12).map((m, i) => ({
      role: m.role,
      content: m.content,
      marcaTiempo: Date.now() - (chatTurns.length - i) * 1000,
    })),
    tienda.registroComandos.list().slice(0, 40).map((c) => ({
      type: c.type,
      category: 'system' as const,
      description: c.description,
      risk: c.risk,
    })),
  )

  const memoryBlock =
    assembled.contextWindow.level4_sessionMemory.length > 0
      ? [
          '## Memoria de sesión',
          ...assembled.contextWindow.level4_sessionMemory.slice(0, 8).map((m) => `- ${m.content}`),
        ].join('\n')
      : ''

  return [
    buildReadOnlyProjectContext(state),
    '',
    formatSessionRulesBlock(rules),
    '',
    libraryPresetsBlock
      ? `## Biblioteca de presets (global + proyecto)\nUsa presetId en Music Build; preferir sobre plugin.setParameter.\n${libraryPresetsBlock}`
      : '',
    plan?.content ? `## plan.md (fuente de verdad)\n${plan.content.slice(0, 8000)}` : '',
    '',
    memoryBlock,
    '',
    '## Capabilities',
    assembled.capabilitiesPrompt,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Herramientas de respaldo (A1): las heurísticas en cascada del single-shot convertidas en
 * herramientas invocables `fallback.*`. Solo CALCULAN acciones propuestas a partir del estado
 * (clase `read`); ejecutarlas sigue pasando por la política y la tarjeta Aplicar.
 *
 * El programa de turno las invoca vía `ctx.executeTools` (quedan en la bitácora del run y emiten
 * eventos tool.call/tool.result) y un agente con tools nativas también puede llamarlas.
 */

import type { TurnContext } from '@jaswave/ai-harness'
import type { DAWState } from '../../../shared/src/types/state'
import {
  buildMidiAuditFixActions,
  buildMidiClipEditActions,
  buildSplitLongClipsActions,
  buildStyleEnhanceActions,
  styleEnhanceProfileFromText,
} from './ai-read-context'
import { fallbackActionsFromUserIntent, type DawAction } from './ai-daw-agent'
import type { AgentMode } from './ai-modes'

export const FALLBACK_TOOLS = {
  userIntent: 'fallback.userIntent',
  styleEnhance: 'fallback.styleEnhance',
  midiClipEdit: 'fallback.midiClipEdit',
  sectionSplit: 'fallback.sectionSplit',
  midiAuditFix: 'fallback.midiAuditFix',
} as const

export type FallbackToolName = (typeof FALLBACK_TOOLS)[keyof typeof FALLBACK_TOOLS]

export const FALLBACK_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(FALLBACK_TOOLS))

export function isFallbackTool(name: string): boolean {
  return FALLBACK_TOOL_NAMES.has(name)
}

/** Cálculo puro de la propuesta de una herramienta de respaldo. */
export function computeFallbackActions(name: string, state: DAWState, args: Record<string, unknown> = {}): DawAction[] {
  const text = String(args.text ?? '')
  switch (name) {
    case FALLBACK_TOOLS.userIntent:
      return fallbackActionsFromUserIntent(text, state, (String(args.mode ?? 'auto') as AgentMode) || 'auto')
    case FALLBACK_TOOLS.styleEnhance:
      return buildStyleEnhanceActions(state, styleEnhanceProfileFromText(text)) as DawAction[]
    case FALLBACK_TOOLS.midiClipEdit:
      return buildMidiClipEditActions(state, text) as DawAction[]
    case FALLBACK_TOOLS.sectionSplit:
      return buildSplitLongClipsActions(state) as DawAction[]
    case FALLBACK_TOOLS.midiAuditFix:
      return buildMidiAuditFixActions(state) as DawAction[]
    default:
      return []
  }
}

/**
 * Invoca una herramienta de respaldo a través del motor (bitácora + eventos + política).
 * Si el host la rechaza, no se propone nada (fail closed).
 */
export async function runFallbackTool(
  ctx: TurnContext,
  name: FallbackToolName,
  args: Record<string, unknown> = {},
): Promise<DawAction[]> {
  const [r] = await ctx.executeTools([{ id: ctx.newId('fb'), name, arguments: args }])
  if (!r || r.status !== 'success') return []
  const actions = (r.data as { actions?: DawAction[] } | undefined)?.actions
  return Array.isArray(actions) ? actions : []
}

/**
 * Puente jas-wave ↔ bucle de razonamiento profundo (@jaswave/ai-harness).
 */

import type { AgentMode, ReasoningChatTurn, ReasoningStep } from '@jaswave/ai-harness'
import { isReadOnlyAction, runReasoningLoop, type HarnessDawAction } from '@jaswave/ai-harness'
import type { TiendaDAW } from '../../../shared/src/state/tienda'
import type { DAWState } from '../../../shared/src/types/state'
import { buildAssembledAgentContext } from './agent-context-bridge'
import { executeDawActions, formatActionResultsForUser, type ActionResult } from './ai-daw-agent'
import type { StoredChatMessage } from './ai-chat-store'

export type StoredReasoningStep = NonNullable<StoredChatMessage['reasoningSteps']>[number]

export function toStoredReasoningStep(step: ReasoningStep, collapsed = false): StoredReasoningStep {
  return {
    phase: step.phase,
    title: step.title,
    content: step.content,
    toolsUsed: step.toolsUsed?.map((t) => t.type),
    collapsed,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
  }
}

export async function runAgentReasoningForTurn(opts: {
  tienda: TiendaDAW
  state: DAWState
  userText: string
  resolvedMode: AgentMode
  chatTurns: Array<{ role: 'user' | 'assistant'; content: string }>
  libraryPresetsBlock?: string
  onStep?: (steps: StoredReasoningStep[]) => void
  onPhaseLabel?: (label: string) => void
  abort?: AbortSignal
  chatFn?: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  /** Pausa entre fases LLM (ms) — gateways cloud (Kilo Code) necesitan más espacio. */
  paceBetweenPhasesMs?: number
}): Promise<{ steps: StoredReasoningStep[]; finalUserMessage: string; decisionBrief: string }> {
  const { formatLibraryPresetsForContext } = await import('./library/ops')
  const presetsBlock =
    opts.libraryPresetsBlock ?? (await formatLibraryPresetsForContext(opts.tienda, 12))
  const projectContext = buildAssembledAgentContext(
    opts.tienda,
    opts.state,
    opts.userText,
    opts.chatTurns,
    presetsBlock,
  )

  const storedSteps: StoredReasoningStep[] = []

  const chat =
    opts.chatFn ??
    (async (_messages: ReasoningChatTurn[]) => ({
      success: false,
      content: undefined,
    }))

  const runReadTools = async (actions: HarnessDawAction[]) => {
    const safe = actions.filter((a) => isReadOnlyAction(a))
    if (!safe.length) return '(sin acciones read-only válidas)'
    const results: ActionResult[] = await executeDawActions(opts.tienda, safe, {
      agentMode: 'ask',
      respectModeGate: false,
      forceApply: false,
    })
    return formatActionResultsForUser(results)
  }

  const loop = await runReasoningLoop({
    userText: opts.userText,
    mode: opts.resolvedMode,
    projectContext,
    chat,
    runReadTools,
    abort: opts.abort,
    paceBetweenPhasesMs: opts.paceBetweenPhasesMs,
    onStep: (step) => {
      const stored = toStoredReasoningStep(step, false)
      storedSteps.push(stored)
      opts.onPhaseLabel?.(stored.title)
      opts.onStep?.([...storedSteps])
    },
  })

  return {
    steps: storedSteps.length
      ? storedSteps.map((s, i) => ({
          ...s,
          collapsed: i < storedSteps.length - 1,
        }))
      : loop.steps.map((s, i) => toStoredReasoningStep(s, i < loop.steps.length - 1)),
    finalUserMessage: loop.finalUserMessage,
    decisionBrief: loop.decisionBrief,
  }
}

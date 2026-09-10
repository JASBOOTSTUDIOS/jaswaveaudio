/**
 * Puente jas-wave ↔ bucle de razonamiento profundo (@jaswave/ai-harness).
 */

import type { AgentMode, ReasoningChatTurn, ReasoningStep } from '@jaswave/ai-harness'
import {
  isReadOnlyAction,
  runCouncilReviewReasoning,
  runReasoningLoop,
  type HarnessDawAction,
} from '@jaswave/ai-harness'
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
  /** Bloque extra (p. ej. auditoría MIDI local) anclado al contexto de razonamiento. */
  projectContextExtra?: string
  onStep?: (steps: StoredReasoningStep[]) => void
  onPhaseLabel?: (label: string) => void
  abort?: AbortSignal
  chatFn?: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  /** Pausa entre fases LLM (ms) — gateways cloud (Kilo Code) necesitan más espacio. */
  paceBetweenPhasesMs?: number
}): Promise<{
  steps: StoredReasoningStep[]
  finalUserMessage: string
  decisionBrief: string
  depth?: number
  depthReason?: string
  canonicalPrompt?: string
}> {
  const { formatLibraryPresetsForContext } = await import('./library/ops')
  const presetsBlock =
    opts.libraryPresetsBlock ?? (await formatLibraryPresetsForContext(opts.tienda, 40))
  const baseContext = buildAssembledAgentContext(
    opts.tienda,
    opts.state,
    opts.userText,
    opts.chatTurns,
    presetsBlock,
  )
  const projectContext = opts.projectContextExtra?.trim()
    ? `${baseContext}\n\n${opts.projectContextExtra.trim()}`
    : baseContext

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
    onDepthPlan: ({ depth, reason, source, canonicalPrompt }) => {
      if (depth <= 0) {
        opts.onPhaseLabel?.('Traduciendo pedido…')
        return
      }
      const src = source === 'model' ? 'IA' : source === 'override' ? 'fijo' : 'auto'
      opts.onPhaseLabel?.(
        depth <= 3
          ? `Consejo rápido (${depth} voces, ${src})…`
          : depth >= 8
            ? `Consejo en debate profundo (${depth} capas, ${src})…`
            : `Consejo de modelos (${depth} capas, ${src})…`,
      )
      void reason
      void canonicalPrompt
    },
    onStep: (step) => {
      const stored = toStoredReasoningStep(step, false)
      const existingIdx = storedSteps.findIndex((s) => s.phase === stored.phase && s.startedAt === stored.startedAt)
      if (existingIdx >= 0) storedSteps[existingIdx] = stored
      else if (stored.phase === 'normalize' && storedSteps[0]?.phase === 'normalize') {
        storedSteps[0] = stored
      } else {
        storedSteps.push(stored)
      }
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
    depth: loop.depth,
    depthReason: loop.depthReason,
    canonicalPrompt: loop.canonicalPrompt,
  }
}

/** Tras Aplicar / respuesta: consejo dialoga (Kael QA) y decide si el trabajo va bien. */
export async function runCouncilReviewForTurn(opts: {
  tienda: TiendaDAW
  state: DAWState
  userText: string
  resolvedMode: AgentMode
  applyOutcome: string
  chatTurns?: Array<{ role: 'user' | 'assistant'; content: string }>
  onStep?: (steps: StoredReasoningStep[]) => void
  onPhaseLabel?: (label: string) => void
  abort?: AbortSignal
  chatFn?: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  paceBetweenPhasesMs?: number
}): Promise<{
  steps: StoredReasoningStep[]
  finalUserMessage: string
  decisionBrief: string
}> {
  const { formatLibraryPresetsForContext } = await import('./library/ops')
  const presetsBlock = await formatLibraryPresetsForContext(opts.tienda, 40)
  const projectContext = buildAssembledAgentContext(
    opts.tienda,
    opts.state,
    opts.userText,
    opts.chatTurns ?? [],
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

  const loop = await runCouncilReviewReasoning({
    userText: opts.userText,
    mode: opts.resolvedMode,
    projectContext,
    applyOutcome: opts.applyOutcome,
    chat,
    runReadTools,
    abort: opts.abort,
    paceBetweenPhasesMs: opts.paceBetweenPhasesMs,
    onDepthPlan: ({ depth }) => {
      opts.onPhaseLabel?.(
        depth >= 4
          ? 'Consejo revisando lo aplicado (Kael QA)…'
          : 'Consejo en diálogo post-Aplicar…',
      )
    },
    onStep: (step) => {
      const stored = toStoredReasoningStep(step, false)
      const existingIdx = storedSteps.findIndex(
        (s) => s.phase === stored.phase && s.startedAt === stored.startedAt,
      )
      if (existingIdx >= 0) storedSteps[existingIdx] = stored
      else storedSteps.push(stored)
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

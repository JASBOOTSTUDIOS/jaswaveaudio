/**
 * Bucle de razonamiento profundo multi-paso (estilo agente Cursor).
 * 6 fases LLM internas + brief para turno final (cliente jas-wave).
 */

import type { HarnessDawAction } from '../types/actions'
import type { AgentMode } from './modes'
import {
  REASONING_PHASE_META,
  buildFinalTurnUserMessage,
  promptForPhase,
  reasoningSystemPreamble,
  type ReasoningPhase,
} from './reasoning-prompts'

export type { ReasoningPhase } from './reasoning-prompts'

export type ReasoningStep = {
  id: string
  phase: ReasoningPhase
  title: string
  content: string
  toolsUsed?: Array<{ type: string; summary: string }>
  startedAt: number
  endedAt: number
}

export type ReasoningChatTurn = { role: 'system' | 'user' | 'assistant'; content: string }

const READ_RE = /<<<READ\s*([\s\S]*?)\s*READ>>>/gi

const RESEARCH_PHASES = new Set<ReasoningPhase>(['research1', 'research2'])

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function parseReadBlockFromText(text: string): HarnessDawAction[] {
  const actions: HarnessDawAction[] = []
  for (const m of text.matchAll(READ_RE)) {
    const raw = (m[1] ?? '').trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object' && typeof (item as { type?: string }).type === 'string') {
            actions.push({
              type: String((item as { type: string }).type),
              payload: ((item as { payload?: Record<string, unknown> }).payload ?? {}) as Record<
                string,
                unknown
              >,
            })
          }
        }
      }
    } catch {
      /* ignore malformed READ */
    }
  }
  return actions.slice(0, 4)
}

export function stripReadBlock(text: string): string {
  return text.replace(READ_RE, '').trim()
}

function newStepId(phase: ReasoningPhase): string {
  return `rs-${phase}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}

function summarizeSteps(steps: ReasoningStep[]): string {
  return steps
    .map((s, i) => `${i + 1}. ${s.title}\n${s.content.slice(0, 600)}${s.content.length > 600 ? '…' : ''}`)
    .join('\n\n')
}

export type RunReasoningLoopOpts = {
  userText: string
  mode: AgentMode
  projectContext: string
  chat: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  runReadTools: (actions: HarnessDawAction[]) => Promise<string>
  onStep?: (step: ReasoningStep) => void
  /** Fases a ejecutar (default: todas). Repair harness usa subconjunto. */
  phases?: ReasoningPhase[]
  /** Pausa entre fases LLM (ms) — evita rate limit en gateways cloud. */
  paceBetweenPhasesMs?: number
  abort?: AbortSignal
}

const DEFAULT_PHASES: ReasoningPhase[] = [
  'think1',
  'research1',
  'think2',
  'research2',
  'analysis',
  'decision',
]

export async function runReasoningLoop(
  opts: RunReasoningLoopOpts,
): Promise<{ steps: ReasoningStep[]; decisionBrief: string; finalUserMessage: string }> {
  const phases = opts.phases ?? DEFAULT_PHASES
  const steps: ReasoningStep[] = []
  const system = reasoningSystemPreamble(opts.mode)

  const runPhase = async (phase: ReasoningPhase, toolResults?: string): Promise<string> => {
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    const meta = REASONING_PHASE_META[phase]
    const startedAt = Date.now()
    const userContent = promptForPhase(phase, {
      userText: opts.userText,
      mode: opts.mode,
      projectContext: opts.projectContext,
      priorSteps: summarizeSteps(steps),
      toolResults,
    })
    const result = await opts.chat([
      { role: 'system', content: system },
      { role: 'user', content: userContent },
    ])
    const raw = result.success && result.content?.trim() ? result.content.trim() : '(sin respuesta del modelo)'
    let content = stripReadBlock(raw)
    let toolsUsed: ReasoningStep['toolsUsed']

    if (RESEARCH_PHASES.has(phase)) {
      const readActions = parseReadBlockFromText(raw)
      if (readActions.length) {
        const toolOut = await opts.runReadTools(readActions)
        toolsUsed = readActions.map((a) => ({
          type: a.type,
          summary: a.type,
        }))
        content = `${content}\n\n---\nConsultas ejecutadas:\n${toolOut}`.trim()
      }
    }

    const step: ReasoningStep = {
      id: newStepId(phase),
      phase,
      title: meta.title,
      content,
      toolsUsed,
      startedAt,
      endedAt: Date.now(),
    }
    steps.push(step)
    opts.onStep?.(step)
    return content
  }

  for (let i = 0; i < phases.length; i++) {
    if (i > 0 && opts.paceBetweenPhasesMs) {
      await sleepMs(opts.paceBetweenPhasesMs)
    }
    await runPhase(phases[i]!)
  }

  const decisionStep = steps.find((s) => s.phase === 'decision')
  const decisionBrief = decisionStep?.content ?? steps[steps.length - 1]?.content ?? ''
  const finalUserMessage = buildFinalTurnUserMessage({
    userText: opts.userText,
    decisionBrief,
    stepsSummary: summarizeSteps(steps),
  })

  return { steps, decisionBrief, finalUserMessage }
}

/** Subconjunto abreviado para harness de reparación (3 fases). */
export const REASONING_REPAIR_PHASES: ReasoningPhase[] = ['think1', 'research1', 'decision']

export async function runAbbreviatedReasoning(
  opts: Omit<RunReasoningLoopOpts, 'phases'> & { repairContext: string },
): Promise<string> {
  const r = await runReasoningLoop({
    ...opts,
    userText: `${opts.userText}\n\n## Contexto de reparación\n${opts.repairContext}`,
    phases: REASONING_REPAIR_PHASES,
  })
  return r.finalUserMessage
}

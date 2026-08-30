/**
 * Bucle de razonamiento profundo — 7 capas en monólogo continuo.
 */

import type { HarnessDawAction } from '../types/actions'
import type { AgentMode } from './modes'
import {
  REASONING_PHASE_META,
  buildFinalTurnUserMessage,
  promptForPhase,
  reasoningSeedUserMessage,
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

/** Frases típicas de “asistente hablando al usuario” — se recortan del monólogo. */
const ASSISTANT_OPENERS =
  /^(¡?\s*(perfecto|claro|entendido|por supuesto|excelente|genial|ok(ay)?|vamos|aquí (está|tienes)|respuesta visible)[!.…]?\s*)+/i

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

/** Limpia tono de chatbot en notas mentales. */
export function sanitizeInnerThought(text: string): string {
  let t = text.trim()
  t = t.replace(ASSISTANT_OPENERS, '')
  // Quitar encabezados tipo “Plan:” / “Respuesta Visible:” que no son pensamiento
  t = t.replace(/^#{1,3}\s*(plan|respuesta|acciones?)\b[^\n]*\n+/gim, '')
  t = t.replace(/\*{0,2}respuesta visible\*{0,2}\s*:?\s*/gi, '')
  return t.trim() || text.trim()
}

function newStepId(phase: ReasoningPhase): string {
  return `rs-${phase}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
}

function summarizeSteps(steps: ReasoningStep[]): string {
  return steps
    .map((s) => `${s.title}\n${s.content.slice(0, 500)}${s.content.length > 500 ? '…' : ''}`)
    .join('\n\n—\n\n')
}

export type RunReasoningLoopOpts = {
  userText: string
  mode: AgentMode
  projectContext: string
  chat: (messages: ReasoningChatTurn[]) => Promise<{ success: boolean; content?: string }>
  runReadTools: (actions: HarnessDawAction[]) => Promise<string>
  onStep?: (step: ReasoningStep) => void
  phases?: ReasoningPhase[]
  paceBetweenPhasesMs?: number
  abort?: AbortSignal
}

const DEFAULT_PHASES: ReasoningPhase[] = [
  'sense',
  'frame',
  'research1',
  'critique',
  'research2',
  'synthesize',
  'commit',
]

export async function runReasoningLoop(
  opts: RunReasoningLoopOpts,
): Promise<{ steps: ReasoningStep[]; decisionBrief: string; finalUserMessage: string }> {
  const phases = opts.phases ?? DEFAULT_PHASES
  const steps: ReasoningStep[] = []
  const system = reasoningSystemPreamble(opts.mode)

  // Hilo continuo: system + semilla + (assistant thought / user cue)* 
  const thread: ReasoningChatTurn[] = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: reasoningSeedUserMessage({
        userText: opts.userText,
        projectContext: opts.projectContext,
      }),
    },
  ]

  const runPhase = async (phase: ReasoningPhase): Promise<string> => {
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    const meta = REASONING_PHASE_META[phase]
    const startedAt = Date.now()

    const cue = promptForPhase(phase, {
      userText: opts.userText,
      mode: opts.mode,
      projectContext: opts.projectContext,
      priorSteps: '',
      continuum: true,
    })
    thread.push({ role: 'user', content: cue })

    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    const result = await opts.chat([...thread])
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    const raw =
      result.success && result.content?.trim() ? result.content.trim() : '(sin respuesta del modelo)'
    let content = sanitizeInnerThought(stripReadBlock(raw))
    let toolsUsed: ReasoningStep['toolsUsed']

    if (RESEARCH_PHASES.has(phase)) {
      const readActions = parseReadBlockFromText(raw)
      if (readActions.length) {
        if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
        const toolOut = await opts.runReadTools(readActions)
        if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
        toolsUsed = readActions.map((a) => ({
          type: a.type,
          summary: a.type,
        }))
        const toolNote = `Consulté: ${toolOut.slice(0, 2500)}`
        content = `${content}\n\n${toolNote}`.trim()
        thread.push({ role: 'assistant', content })
        thread.push({
          role: 'user',
          content: `## Resultado de consultas (capa ${meta.layer})\n${toolOut.slice(0, 3500)}\nIncorpóralo en silencio en capas siguientes; no lo recopies entero.`,
        })
      } else {
        thread.push({ role: 'assistant', content })
      }
    } else {
      thread.push({ role: 'assistant', content })
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
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (i > 0 && opts.paceBetweenPhasesMs) {
      await sleepMs(opts.paceBetweenPhasesMs)
      if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    await runPhase(phases[i]!)
  }

  const decisionStep = steps.find((s) => s.phase === 'commit')
  const decisionBrief = decisionStep?.content ?? steps[steps.length - 1]?.content ?? ''
  const finalUserMessage = buildFinalTurnUserMessage({
    userText: opts.userText,
    decisionBrief,
    stepsSummary: summarizeSteps(steps),
    mode: opts.mode,
  })

  return { steps, decisionBrief, finalUserMessage }
}

/** Subconjunto abreviado para harness de reparación (3 capas). */
export const REASONING_REPAIR_PHASES: ReasoningPhase[] = ['sense', 'research1', 'commit']

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

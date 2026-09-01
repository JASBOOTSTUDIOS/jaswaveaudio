/**
 * Bucle de razonamiento profundo — 1ª capa = traduce el pedido (modelo elige profundidad 2–10).
 */

import type { HarnessDawAction } from '../types/actions'
import type { AgentMode } from './modes'
import { isStyleGapIntent, wantsWebResearch } from './modes'
import {
  clampReasoningDepth,
  parseModelIntentBrief,
  planReasoningPhases,
  remainingPhasesAfterNormalize,
  stripIntentBlock,
  type ModelIntentBrief,
  REASONING_MAX_STEPS,
  REASONING_MIN_STEPS,
} from './reasoning-depth'
import {
  buildFinalTurnUserMessage,
  formatPhaseTitle,
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
  onDepthPlan?: (plan: {
    depth: number
    reason: string
    phases: ReasoningPhase[]
    source: 'model' | 'heuristic' | 'override'
    canonicalPrompt?: string
  }) => void
}

export async function runReasoningLoop(
  opts: RunReasoningLoopOpts,
): Promise<{
  steps: ReasoningStep[]
  decisionBrief: string
  finalUserMessage: string
  depth: number
  depthReason: string
  canonicalPrompt: string
  intent?: ModelIntentBrief
}> {
  const steps: ReasoningStep[] = []
  const originalUserText = opts.userText
  let workingUserText = opts.userText
  let depth = REASONING_MIN_STEPS
  let depthReason = 'mínimo'
  let depthSource: 'model' | 'heuristic' | 'override' = 'heuristic'
  let intentBrief: ModelIntentBrief | undefined

  // Override explícito: plan fijo (p. ej. reparación)
  if (opts.phases?.length) {
    const plan = planReasoningPhases(opts.userText, opts.mode, opts.phases)
    depth = plan.depth
    depthReason = plan.reason
    depthSource = 'override'
    opts.onDepthPlan?.({
      depth,
      reason: depthReason,
      phases: plan.phases,
      source: 'override',
    })

    const system = reasoningSystemPreamble(opts.mode, depth)
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

    await runPhases(opts, plan.phases, depth, workingUserText, thread, steps)
  } else {
    // Flujo normal: 1) normalize (modelo elige depth + prompt canónico) 2) resto
    const system = reasoningSystemPreamble(opts.mode)
    const thread: ReasoningChatTurn[] = [
      { role: 'system', content: system },
      {
        role: 'user',
        content: reasoningSeedUserMessage({
          userText: originalUserText,
          projectContext: opts.projectContext,
        }),
      },
    ]

    opts.onDepthPlan?.({
      depth: 0,
      reason: 'traduciendo pedido…',
      phases: ['normalize'],
      source: 'model',
    })

    const normalizeRaw = await runOnePhase(opts, {
      phase: 'normalize',
      index: 1,
      total: 0, // provisional hasta saber depth
      userText: originalUserText,
      thread,
      steps,
      titleOverride: '1/… · Traducir pedido',
    })

    intentBrief = parseModelIntentBrief(normalizeRaw, originalUserText) ?? undefined
    if (intentBrief) {
      workingUserText = intentBrief.promptCanonico
      depth = clampReasoningDepth(intentBrief.depth)
      depthReason = intentBrief.depthReason || `modelo: intent=${intentBrief.intent}`
      depthSource = 'model'
      // Si el modelo se equivoca y marca create_song en un gap/análisis, corrige
      if (
        (isStyleGapIntent(originalUserText) || wantsWebResearch(originalUserText)) &&
        /create_song|plan/i.test(intentBrief.intent)
      ) {
        workingUserText =
          intentBrief.promptCanonico.replace(/\bcrea(r)?\b/gi, 'audita').trim() ||
          originalUserText
        depthReason = `${depthReason} · corregido a style_gap/ask`
      }
    } else {
      const fallback = planReasoningPhases(originalUserText, opts.mode)
      depth = fallback.depth
      depthReason = `fallback heurístico (${fallback.reason}); sin <<<INTENT>>>`
      depthSource = 'heuristic'
    }

    // Gap de estilo / web: asegurar capas de research DAW + web (mín. 8)
    if (isStyleGapIntent(originalUserText) || wantsWebResearch(originalUserText) || isStyleGapIntent(workingUserText)) {
      if (depth < 8) {
        depth = 9
        depthReason = `${depthReason} · forzado ≥8 (style_gap/web)`
      }
    }

    // Retitular normalize in-place (mismo step; no volver a emitir onStep como capa nueva)
    if (steps[0]) {
      steps[0].title = formatPhaseTitle('normalize', 1, depth)
      steps[0].content = stripIntentBlock(steps[0].content) || steps[0].content
      opts.onStep?.(steps[0])
    }

    const remaining = remainingPhasesAfterNormalize(depth)
    const fullPhases: ReasoningPhase[] = ['normalize', ...remaining]
    opts.onDepthPlan?.({
      depth,
      reason: depthReason,
      phases: fullPhases,
      source: depthSource,
      canonicalPrompt: workingUserText,
    })

    // Anclar el prompt canónico en el hilo para capas siguientes
    if (workingUserText.trim() !== originalUserText.trim()) {
      thread.push({
        role: 'user',
        content: [
          `## Pedido canónico (capa 1/${depth} — úsalo de aquí en adelante)`,
          workingUserText,
          intentBrief?.aliasesMapped?.length
            ? `Aliases: ${intentBrief.aliasesMapped.map((a) => `«${a.from}»→«${a.to}»`).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      })
    }

    for (let i = 0; i < remaining.length; i++) {
      if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (opts.paceBetweenPhasesMs) {
        await sleepMs(opts.paceBetweenPhasesMs)
        if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
      }
      await runOnePhase(opts, {
        phase: remaining[i]!,
        index: i + 2,
        total: depth,
        userText: workingUserText,
        thread,
        steps,
      })
    }
  }

  const decisionStep = steps.find((s) => s.phase === 'commit')
  const decisionBrief = decisionStep?.content ?? steps[steps.length - 1]?.content ?? ''
  const finalUserMessage = buildFinalTurnUserMessage({
    userText: originalUserText,
    canonicalPrompt: workingUserText !== originalUserText ? workingUserText : undefined,
    decisionBrief,
    stepsSummary: summarizeSteps(steps),
    mode: opts.mode,
    depth,
  })

  return {
    steps,
    decisionBrief,
    finalUserMessage,
    depth,
    depthReason,
    canonicalPrompt: workingUserText,
    intent: intentBrief,
  }
}

async function runPhases(
  opts: RunReasoningLoopOpts,
  phases: ReasoningPhase[],
  depth: number,
  userText: string,
  thread: ReasoningChatTurn[],
  steps: ReasoningStep[],
): Promise<void> {
  for (let i = 0; i < phases.length; i++) {
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (i > 0 && opts.paceBetweenPhasesMs) {
      await sleepMs(opts.paceBetweenPhasesMs)
      if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    }
    await runOnePhase(opts, {
      phase: phases[i]!,
      index: i + 1,
      total: depth,
      userText,
      thread,
      steps,
    })
  }
}

async function runOnePhase(
  opts: RunReasoningLoopOpts,
  args: {
    phase: ReasoningPhase
    index: number
    total: number
    userText: string
    thread: ReasoningChatTurn[]
    steps: ReasoningStep[]
    titleOverride?: string
  },
): Promise<string> {
  if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
  const { phase, index, total, userText, thread, steps } = args
  const startedAt = Date.now()
  const title =
    args.titleOverride ??
    formatPhaseTitle(phase, index, Math.max(total, REASONING_MIN_STEPS))

  const cue = promptForPhase(phase, {
    userText,
    mode: opts.mode,
    projectContext: opts.projectContext,
    priorSteps: '',
    continuum: true,
    phaseIndex: index,
    phaseTotal: total > 0 ? total : Math.max(index, REASONING_MAX_STEPS),
  })
  thread.push({ role: 'user', content: cue })

  if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
  let result = await opts.chat([...thread])
  if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
  let raw =
    result.success && result.content?.trim() ? result.content.trim() : ''

  // Reintento único si commit (o cualquier capa) vuelve vacío — evita «(sin respuesta del modelo)»
  if (!raw && phase === 'commit') {
    if (opts.paceBetweenPhasesMs) await sleepMs(Math.min(opts.paceBetweenPhasesMs, 2000))
    if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
    thread.push({
      role: 'user',
      content:
        'La capa anterior falló vacía. ESCRIBE ahora 5–8 bullets de compromiso (diagnóstico/gaps o ACTIONS). PROHIBIDO vacío, ¡¡¡ o plan multi-día.',
    })
    result = await opts.chat([...thread])
    raw = result.success && result.content?.trim() ? result.content.trim() : ''
  }
  if (!raw) raw = '(sin respuesta del modelo)'

  // En normalize conservamos INTENT en el hilo; en UI se limpia después
  let content =
    phase === 'normalize'
      ? sanitizeInnerThought(stripReadBlock(raw))
      : sanitizeInnerThought(stripIntentBlock(stripReadBlock(raw)))
  let toolsUsed: ReasoningStep['toolsUsed']

  if (RESEARCH_PHASES.has(phase)) {
    let readActions = parseReadBlockFromText(raw)
    // Si pidió internet y estamos en research2 sin web.search, inyéctalo
    if (
      phase === 'research2' &&
      (wantsWebResearch(userText) || isStyleGapIntent(userText)) &&
      !readActions.some((a) => a.type === 'web.search')
    ) {
      const q =
        userText.match(/(?:estilo|como|tipo)\s+([^,.]+)/i)?.[1]?.trim() ||
        ( /aver|morillo/i.test(userText)
          ? 'Averill Morillo Averly Morillo worship drums live groove'
          : 'worship modern drums groove ghost notes hi-hat' )
      readActions = [
        ...readActions,
        {
          type: 'web.search',
          payload: {
            query: `${q} worship contemporary christian drummer characteristics`,
          },
        },
      ].slice(0, 4)
    }
    if (readActions.length) {
      if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
      const toolOut = await opts.runReadTools(readActions)
      if (opts.abort?.aborted) throw new DOMException('Aborted', 'AbortError')
      toolsUsed = readActions.map((a) => ({ type: a.type, summary: a.type }))
      const toolNote = `Consulté: ${toolOut.slice(0, 2500)}`
      content = `${content}\n\n${toolNote}`.trim()
      thread.push({ role: 'assistant', content })
      thread.push({
        role: 'user',
        content: `## Resultado de consultas (capa ${index}/${total || '?'})\n${toolOut.slice(0, 3500)}\nIncorpóralo en silencio en capas siguientes; no lo recopies entero.`,
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
    title,
    content: phase === 'normalize' ? stripIntentBlock(content) || content : content,
    toolsUsed,
    startedAt,
    endedAt: Date.now(),
  }
  // Para parsear INTENT necesitamos el raw completo en el return; el step UI ya va limpio
  steps.push(step)
  opts.onStep?.(step)
  return raw
}

/** Subconjunto abreviado para harness de reparación (3 capas). */
export const REASONING_REPAIR_PHASES: ReasoningPhase[] = ['normalize', 'research1', 'commit']

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

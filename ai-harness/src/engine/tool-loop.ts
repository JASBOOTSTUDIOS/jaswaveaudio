/**
 * Programa por defecto del motor: bucle nativo de herramientas.
 *
 * chat(tools) → tool calls → guarda de modo (A3) + política → ejecutar lecturas/escrituras →
 * resultados como mensajes `tool` no confiables → repetir hasta `agent.complete`/texto final,
 * una pregunta real al usuario, una confirmación destructiva/sistema o el presupuesto.
 *
 * A5 lo ampliará con pasos del plan, QA por paso y batch con un undo por iteración.
 */

import { agentDecisionFromChatResponse, AGENT_CONTROL_TOOL_SCHEMAS } from '../recovery/parse-agent-decision'
import { toolResultMessage } from './chat'
import type {
  EngineAnswer,
  EngineNeed,
  EngineToolCall,
  EngineToolSchema,
  TurnProgram,
  TurnProgramOutcome,
} from './engine-types'
import { gateToolForMode } from './mode-capabilities'
import type { TurnContext } from './turn-context'

export const TOOL_LOOP_PROGRAM_ID = 'tool-loop'

export const TOOL_LOOP_DEFAULTS = {
  maxIterations: 24,
  maxCallsPerIteration: 8,
} as const

export type ToolLoopOptions = Partial<typeof TOOL_LOOP_DEFAULTS>

function stableArgsKey(name: string, args: Record<string, unknown>): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort)
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      )
    }
    return v
  }
  return `${name}:${JSON.stringify(sort(args))}`
}

/** Herramientas visibles para el modo (A3): en modos sin mutación solo lecturas (+ plan.* en plan). */
export function toolsForModeFromHost(ctx: TurnContext): EngineToolSchema[] {
  const listed = ctx.host.listTools?.({ mode: ctx.run.mode, role: ctx.run.role }) ?? []
  const visible = listed.filter((t) => {
    const cls = ctx.classify({ id: 't', name: t.name, arguments: {} })
    const gate = gateToolForMode(ctx.capabilities, t.name, cls, { planApproved: true })
    return gate.allow
  })
  return [...visible, ...AGENT_CONTROL_TOOL_SCHEMAS.map((s) => ({ ...s }))]
}

type ProcessOutcome = { need?: EngineNeed }

/** Gating + ejecución de las llamadas de una iteración. Añade los mensajes `tool`. */
async function processCalls(ctx: TurnContext, calls: EngineToolCall[], maxPerIteration: number): Promise<ProcessOutcome> {
  const { run } = ctx
  const toRun: EngineToolCall[] = []
  const planCalls: EngineToolCall[] = []
  const confirmCalls: EngineToolCall[] = []
  const seen = new Set<string>()
  const reply = (c: EngineToolCall, status: string, message: string) =>
    run.messages.push(toolResultMessage(c, { status, error: { message } }))

  for (const [i, c] of calls.entries()) {
    if (i >= maxPerIteration) {
      reply(c, 'rejected', `No ejecutada: límite de ${maxPerIteration} llamadas por iteración. Reenvíala en la siguiente.`)
      continue
    }
    const key = stableArgsKey(c.name, c.arguments)
    if (seen.has(key)) {
      reply(c, 'rejected', 'Duplicada en esta iteración (misma herramienta y argumentos): ignorada.')
      continue
    }
    seen.add(key)
    const cls = ctx.classify(c)
    const gate = gateToolForMode(ctx.capabilities, c.name, cls, { planApproved: run.planApproved === true })
    if (!gate.allow) {
      ctx.emit({ type: 'tool.call', role: run.role, call: c })
      ctx.emit({
        type: 'tool.result',
        role: run.role,
        result: { callId: c.id, name: c.name, status: 'rejected', error: { code: 'MODE', message: gate.message } },
      })
      ctx.log({ kind: 'tool', tool: c.name, callId: c.id, status: 'rejected', message: gate.message })
      reply(c, 'rejected', gate.message)
      continue
    }
    if (gate.needs === 'approve-plan') planCalls.push(c)
    else if (gate.needs === 'confirm') confirmCalls.push(c)
    else toRun.push(c)
  }

  if (toRun.length) {
    const results = await ctx.executeTools(toRun)
    for (const [i, r] of results.entries()) run.messages.push(toolResultMessage(toRun[i]!, r))
  }

  if (planCalls.length) {
    const pending = [...planCalls, ...confirmCalls]
    run.pendingCalls = pending
    return {
      need: {
        id: ctx.newId('need'),
        kind: 'approve-plan',
        message: `Antes de modificar el proyecto necesito que apruebes el plan (${pending.length} cambio(s) propuestos).`,
        calls: pending,
        plan: (await ctx.readPlan()) ?? undefined,
      },
    }
  }
  if (confirmCalls.length) {
    run.pendingCalls = confirmCalls
    const system = confirmCalls.some((c) => ctx.classify(c) === 'system')
    return {
      need: {
        id: ctx.newId('need'),
        kind: 'confirm',
        reason: system ? 'system' : 'destructive',
        message: `Confirma ${confirmCalls.length} acción(es) ${system ? 'de sistema' : 'destructiva(s)'}: ${confirmCalls
          .map((c) => c.name)
          .join(', ')}`,
        calls: confirmCalls,
      },
    }
  }
  run.pendingCalls = undefined
  return {}
}

async function loop(ctx: TurnContext, opts: Required<ToolLoopOptions>): Promise<TurnProgramOutcome> {
  const { run } = ctx
  while (run.iterations < opts.maxIterations) {
    ctx.throwIfAborted()
    const iteration = run.iterations
    ctx.phase(`Agente · iteración ${iteration + 1}`, 'agent.iteration')
    const res = await ctx.chat({
      purpose: 'agent',
      messages: run.messages,
      tools: toolsForModeFromHost(ctx),
      iteration,
    })
    if (!res.success) {
      if (res.budgetStop) return { status: 'failed', reason: 'budget', error: res.budgetMessage ?? 'Presupuesto agotado' }
      return { status: 'failed', error: [res.error, res.hint].filter(Boolean).join(' — ') || 'El modelo no respondió' }
    }
    const decision = agentDecisionFromChatResponse(res, { native: true })
    run.iterations += 1
    if (!decision) {
      return { status: 'failed', error: 'El modelo no devolvió una decisión utilizable' }
    }
    if (decision.type === 'tool-calls' || decision.type === 'request-confirmation') {
      const calls: EngineToolCall[] = decision.calls.map((c, n) => ({
        id: `call_${iteration}_${n}`,
        name: c.tool,
        arguments: c.arguments ?? {},
      }))
      run.messages.push({ role: 'assistant', content: res.content ?? '', toolCalls: calls })
      if (!calls.length) continue
      const out = await processCalls(ctx, calls, opts.maxCallsPerIteration)
      if (out.need) return { status: 'needs-user', need: out.need, summary: out.need.message }
      await ctx.persist()
      continue
    }
    const text = res.content?.trim() ?? ''
    run.messages.push({ role: 'assistant', content: text || ('summary' in decision ? decision.summary : '') })
    if (decision.type === 'complete') {
      const summary = decision.summary || text || 'Hecho.'
      ctx.message(summary, { final: true })
      return { status: 'completed', summary }
    }
    if (decision.type === 'request-user-input') {
      return {
        status: 'needs-user',
        summary: decision.message,
        need: { id: ctx.newId('need'), kind: 'clarify', message: decision.message },
      }
    }
    if (decision.type === 'fail') return { status: 'failed', error: decision.reason }
    // replan: el modelo pide replantear; se le devuelve el control con la razón.
    run.messages.push({ role: 'user', content: `Replantea el siguiente paso: ${decision.reason}` })
  }
  return { status: 'failed', error: `Límite de ${opts.maxIterations} iteraciones del agente` }
}

export function createToolLoopProgram(options: ToolLoopOptions = {}): TurnProgram {
  const opts: Required<ToolLoopOptions> = { ...TOOL_LOOP_DEFAULTS, ...options }
  return {
    id: TOOL_LOOP_PROGRAM_ID,
    async run(ctx) {
      if (!ctx.run.messages.length) {
        for (const h of ctx.input.history ?? []) ctx.run.messages.push({ role: h.role, content: h.content })
        ctx.run.messages.push({ role: 'user', content: ctx.run.userText })
      }
      return loop(ctx, opts)
    },
    async answer(ctx, need: EngineNeed, answer: EngineAnswer) {
      const { run } = ctx
      if (need.kind === 'clarify' || need.kind === 'apply') {
        run.messages.push({ role: 'user', content: answer.text?.trim() || (answer.approved ? 'Sí, continúa.' : 'No.') })
        return loop(ctx, opts)
      }
      const calls = run.pendingCalls?.length ? run.pendingCalls : need.calls
      run.pendingCalls = undefined
      if (!answer.approved) {
        for (const c of calls) run.messages.push(toolResultMessage(c, { status: 'rejected', error: { message: 'El usuario rechazó esta acción.' } }))
        if (answer.text?.trim()) run.messages.push({ role: 'user', content: answer.text.trim() })
        return loop(ctx, opts)
      }
      if (need.kind === 'approve-plan') {
        run.planApproved = true
        if (answer.plan?.trim()) {
          await ctx.host.writeDoc?.('plan.md', answer.plan)
          ctx.emit({ type: 'plan.updated', plan: answer.plan })
        }
        const out = await processCalls(ctx, calls, opts.maxCallsPerIteration)
        if (out.need) return { status: 'needs-user', need: out.need, summary: out.need.message }
        return loop(ctx, opts)
      }
      // confirm: el usuario aprobó destructivas/sistema explícitamente.
      const results = await ctx.executeTools(calls, { userConfirmed: true })
      for (const [i, r] of results.entries()) run.messages.push(toolResultMessage(calls[i]!, r))
      return loop(ctx, opts)
    },
    async resume(ctx) {
      const { run } = ctx
      // Llamadas sin resultado (turno cortado a mitad de ejecución): se marcan para que el modelo decida.
      const last = [...run.messages].reverse().find((m) => m.role === 'assistant')
      if (last && last.role === 'assistant' && last.toolCalls?.length) {
        const answered = new Set(run.messages.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId))
        for (const c of last.toolCalls) {
          if (!answered.has(c.id)) {
            run.messages.push(toolResultMessage(c, { status: 'cancelled', error: { message: 'Interrumpida (recarga); verifica el estado antes de repetir.' } }))
          }
        }
      }
      if (!run.messages.length) return this.run(ctx)
      return loop(ctx, opts)
    },
  }
}

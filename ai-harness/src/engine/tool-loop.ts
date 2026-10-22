/**
 * Programa por defecto del motor: bucle nativo de herramientas.
 *
 * chat(tools) → tool calls → guarda de modo (A3) + política → ejecutar lecturas/escrituras →
 * resultados como mensajes `tool` no confiables → repetir hasta `agent.complete`/texto final,
 * una pregunta real al usuario, una confirmación destructiva/sistema o el presupuesto.
 *
 * A5: en create/auto con un plan estructurado aprobado, el turno orquesta los pasos
 * (`orchestrate`): por paso — sembrar instrucción, bucle propio, QA vía `host.auditStep`,
 * `[x]` con evidencia o reintento/bloqueo — hasta terminar el plan; al final `auditProject`.
 */

import { agentDecisionFromChatResponse, AGENT_CONTROL_TOOL_SCHEMAS } from '../recovery/parse-agent-decision'
import { toolResultMessage } from './chat'
import type {
  EngineAgentRole,
  EngineAnswer,
  EngineNeed,
  EngineProjectAudit,
  EngineStepAudit,
  EngineToolCall,
  EngineToolSchema,
  TurnProgram,
  TurnProgramOutcome,
} from './engine-types'
import { gateProjectAudit, gateStepAudit } from './audit-gate'
import { gateToolForMode, visibleInMode } from './mode-capabilities'
import {
  aprobarPlan,
  diffPlans,
  isStructuredPlan,
  marcarPaso,
  parsePlan,
  planHash,
  serializePlan,
  type PlanDiff,
  type PlanEstructurado,
  type PlanPaso,
} from '../plan/structured-plan'
import type { TurnContext } from './turn-context'
import { createDirectorProgram, DIRECTOR_PROGRAM_ID } from './director-program'

export const TOOL_LOOP_PROGRAM_ID = 'tool-loop'

export const TOOL_LOOP_DEFAULTS = {
  /** Iteraciones máximas de todo el turno (incluye todos los pasos del plan). */
  maxIterations: 60,
  maxCallsPerIteration: 8,
} as const

/** A5: tope de iteraciones y reintentos de QA por paso; el resto del turno sigue vivo. */
export const STEP_LOOP_DEFAULTS = {
  maxStepIterations: 12,
  maxQaRetries: 1,
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

/** Herramientas visibles para el modo (A3): en modos sin mutación solo lecturas (+ plan en plan). */
export function toolsForModeFromHost(ctx: TurnContext): EngineToolSchema[] {
  const listed = ctx.host.listTools?.({ mode: ctx.run.mode, role: ctx.run.role }) ?? []
  const visible = listed.filter((t) => {
    const cls = ctx.classify({ id: 't', name: t.name, arguments: {} })
    return visibleInMode(ctx.capabilities, t.name, cls)
  })
  return [...visible, ...AGENT_CONTROL_TOOL_SCHEMAS.map((s) => ({ ...s }))]
}

type ProcessOutcome = { need?: EngineNeed }

/**
 * A4: relee plan.md antes de cada iteración. Si el hash cambió (edición del
 * usuario a mitad de turno) emite `plan.updated` con el diff y el plan nuevo
 * manda; si el plan estructurado está aprobado, el turno puede mutar sin pedir
 * aprobación de nuevo.
 */
export async function syncPlanState(ctx: TurnContext): Promise<PlanEstructurado | null> {
  const md = await ctx.readPlan()
  if (!md || !isStructuredPlan(md)) return null
  const plan = parsePlan(md)
  if (!plan) return null
  if (plan.estadoPlan === 'aprobado') ctx.run.planApproved = true
  const hash = planHash(md)
  const prevHash = typeof ctx.run.data?.planHash === 'string' ? ctx.run.data.planHash : null
  if (prevHash === hash) return plan
  let diff: PlanDiff | undefined
  const prevMd = typeof ctx.run.data?.planMd === 'string' ? ctx.run.data.planMd : null
  if (prevMd && isStructuredPlan(prevMd)) {
    const before = parsePlan(prevMd)
    if (before) diff = diffPlans(before, plan)
  }
  ctx.run.data = { ...(ctx.run.data ?? {}), planHash: hash, planMd: md }
  ctx.emit({ type: 'plan.updated', plan: md, diff })
  return plan
}

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
    const gate = gateToolForMode(ctx.capabilities, c.name, cls, {
      planApproved: run.planApproved === true,
      args: c.arguments,
    })
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

/** Modo interno del bucle: en un paso, `agent.complete`/prosa terminan el paso sin cerrar el turno. */
type LoopMode = { stopOnComplete: boolean }

export async function loop(ctx: TurnContext, opts: Required<ToolLoopOptions>, mode?: LoopMode): Promise<TurnProgramOutcome> {
  const { run } = ctx
  const stepMode = mode?.stopOnComplete === true
  // En paso, el bucle tiene tope propio: no gasta las iteraciones de los demás pasos.
  const limit = stepMode ? Math.min(opts.maxIterations, run.iterations + STEP_LOOP_DEFAULTS.maxStepIterations) : opts.maxIterations
  const stepData = (extra: Record<string, unknown>) => (stepMode ? { ...extra, stepMarker: true } : extra)
  while (run.iterations < limit) {
    ctx.throwIfAborted()
    await syncPlanState(ctx)
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
        id: `${run.id}:${iteration}:${n}`,
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
      // En paso NO se cierra el turno: el orquestador hace QA y sigue con el siguiente.
      if (stepMode) return { status: 'completed', summary, data: stepData({ stepComplete: true }) }
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
    if (decision.type === 'fail') {
      // En paso, el «fail» del modelo marca el paso para QA/bloqueo; el turno no muere.
      return { status: 'failed', error: decision.reason, data: stepData({ stepFailure: decision.reason }) }
    }
    // replan: el modelo pide replantear; se le devuelve el control con la razón.
    run.messages.push({ role: 'user', content: `Replantea el siguiente paso: ${decision.reason}` })
  }
  return {
    status: 'failed',
    error: `Límite de ${limit} iteraciones del agente`,
    data: stepData({ stepFailure: 'límite de iteraciones del paso' }),
  }
}

// ── A5 · orquestación de pasos del plan (create/auto + plan aprobado) ──────────

export function stepMarkerOf(data: unknown): { stepComplete?: boolean; stepFailure?: unknown } | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { stepMarker?: boolean }
  return d.stepMarker === true ? (data as { stepComplete?: boolean; stepFailure?: unknown }) : null
}

/** Escribe plan.md canónico y actualiza hash/diff del run (fuente de verdad A4). */
export async function writePlan(ctx: TurnContext, plan: PlanEstructurado): Promise<void> {
  const md = serializePlan(plan)
  await ctx.host.writeDoc?.('plan.md', md)
  if (ctx.run.input.planOverride) ctx.run.input.planOverride = md
  ctx.run.data = { ...(ctx.run.data ?? {}), planHash: planHash(md), planMd: md }
  ctx.emit({ type: 'plan.updated', plan: md })
}

export function upsertRunStep(ctx: TurnContext, paso: PlanPaso, status: 'running' | 'done' | 'blocked', evidence?: string[]): void {
  const existing = ctx.run.steps.find((s) => s.id === paso.id)
  if (existing) {
    existing.status = status
    if (evidence?.length) existing.evidence = [...(existing.evidence ?? []), ...evidence]
    return
  }
  ctx.run.steps.push({ id: paso.id, title: paso.titulo, role: ctx.run.role, status, evidence })
}

/** Instrucción sembrada en el hilo para que el modelo trabaje un solo paso. */
export function instructionDePaso(paso: PlanPaso, extra?: string): string {
  return [
    `Trabaja AHORA el paso ${paso.id} del plan (fase ${paso.fase || 'general'}, agente @${paso.agente}): ${paso.titulo}.`,
    paso.criterios.length ? `Criterios de aceptación:\n${paso.criterios.map((c) => `- ${c}`).join('\n')}` : '',
    paso.herramientas.length ? `Herramientas sugeridas: ${paso.herramientas.join(', ')}.` : '',
    extra ?? '',
    'Cuando el paso esté TERMINADO y verificado, termínalo con agent.complete (resumen corto de lo hecho). No empieces pasos siguientes todavía.',
  ]
    .filter(Boolean)
    .join('\n')
}

/** QA del paso vía host. Sin `auditStep` el gate decide (fail closed si hay criterios). */
export async function auditPaso(ctx: TurnContext, paso: PlanPaso): Promise<EngineStepAudit> {
  if (!ctx.host.auditStep) {
    const gate = gateStepAudit({ hayCriterios: paso.criterios.length > 0 })
    return { ok: gate.ok, issues: gate.issues, evidencia: gate.evidencia }
  }
  try {
    return await ctx.host.auditStep({
      runId: ctx.run.id,
      step: {
        id: paso.id,
        fase: paso.fase,
        agente: paso.agente,
        titulo: paso.titulo,
        criterios: [...paso.criterios],
        estado: paso.estado,
      },
    })
  } catch (e) {
    return { ok: false, issues: [`QA interno del host falló: ${e instanceof Error ? e.message : String(e)}`] }
  }
}

/**
 * Cierre del turno con plan: QA del proyecto (A9, fail closed) + resumen de pasos.
 * Sin `audit.project` limpio el turno NO se cierra: vuelve con estado fallido.
 */
export async function finishTurn(ctx: TurnContext, hechos: number, bloqueados: PlanPaso[]): Promise<TurnProgramOutcome> {
  let auditoria: EngineProjectAudit | undefined
  if (ctx.host.auditProject) {
    try {
      auditoria = await ctx.host.auditProject({ runId: ctx.run.id })
    } catch (e) {
      auditoria = { ok: false, issues: [`QA del proyecto falló: ${e instanceof Error ? e.message : String(e)}`] }
    }
  }
  const gate = gateProjectAudit(auditoria)
  const base = [
    `Plan completado: ${hechos} paso(s) terminados`,
    bloqueados.length ? `Bloqueados: ${bloqueados.map((p) => `${p.id} (${p.titulo})`).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  if (!gate.ok) {
    const detalle = `QA del proyecto no pasó: ${gate.issues.join('; ')}`
    ctx.log({ kind: 'error', message: detalle })
    return { status: 'failed', error: `${base} · ${detalle}` }
  }
  const resumen = [
    base,
    gate.warnings.length ? `Avisos: ${gate.warnings.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  ctx.message(resumen, { final: true })
  return { status: 'completed', summary: resumen }
}

/**
 * A5: ejecuta el plan aprobado paso a paso hasta terminar. Un paso falla → reintenta
 * (`maxQaRetries`) → `[!]` bloqueado y SIGUE con el siguiente; el presupuesto/error real
 * del turno sí corta todo. El `agent.complete` del modelo cierra el paso, no el turno.
 */
async function orchestrate(ctx: TurnContext, opts: Required<ToolLoopOptions>): Promise<TurnProgramOutcome> {
  const first = await syncPlanState(ctx)
  if (!first || first.estadoPlan !== 'aprobado') return loop(ctx, opts)
  const tienePend = (p: PlanPaso) => p.estado === 'pendiente' || p.estado === 'en-curso'
  if (!first.pasos.some(tienePend)) return loop(ctx, opts)

  const stepRetries = new Map<string, number>()
  /** Pasos ya resueltos en este turno: aunque el archivo vuelva a mostrarlos, no se repiten. */
  const resueltos = new Set<string>()
  let hechos = 0
  let snapshotTurno = false
  const bloqueados: PlanPaso[] = []

  for (;;) {
    ctx.throwIfAborted()
    await syncPlanState(ctx)
    const md = await ctx.readPlan()
    const plan = md && isStructuredPlan(md) ? parsePlan(md) : null
    if (!plan || plan.estadoPlan !== 'aprobado') {
      // El usuario volvió el plan a borrador a mitad de turno: ya no se muta sin aprobación.
      return hechos || bloqueados.length ? finishTurn(ctx, hechos, bloqueados) : loop(ctx, opts)
    }
    const pend = plan.pasos.find((p) => tienePend(p) && !resueltos.has(p.id))
    if (!pend) return finishTurn(ctx, hechos, bloqueados)

    // Snapshot A5 por paso (y por turno la primera vez) para engine.undoStep/undoTurn.
    if (!snapshotTurno) {
      await ctx.captureSnapshot('turn')
      snapshotTurno = true
    }
    await ctx.captureSnapshot('step', pend.id)
    await writePlan(ctx, marcarPaso(plan, pend.id, 'en-curso'))
    upsertRunStep(ctx, pend, 'running')
    ctx.emit({ type: 'step.started', stepId: pend.id, title: pend.titulo, role: ctx.run.role })
    ctx.log({ kind: 'note', stepId: pend.id, message: `paso ${pend.id} en curso: ${pend.titulo}` })
    ctx.run.messages.push({ role: 'user', content: instructionDePaso(pend) })
    await ctx.persist()

    const out = await loop(ctx, opts, { stopOnComplete: true })
    if (out.status === 'needs-user') return out
    const marker = stepMarkerOf(out.data)
    if (out.status === 'failed' && !marker) return out // presupuesto/error real del turno

    const verdict = await auditPaso(ctx, pend)
    const gate = gateStepAudit({ hayCriterios: pend.criterios.length > 0, verdict })
    const md2 = await ctx.readPlan()
    const plan2 = (md2 && isStructuredPlan(md2) ? parsePlan(md2) : null) ?? plan
    if (gate.ok) {
      await writePlan(ctx, marcarPaso(plan2, pend.id, 'hecho', { evidencia: gate.evidencia }))
      upsertRunStep(ctx, pend, 'done', gate.evidencia)
      ctx.emit({ type: 'step.done', stepId: pend.id, status: 'done', evidence: gate.evidencia })
      ctx.log({ kind: 'note', stepId: pend.id, message: `paso ${pend.id} hecho`, status: 'done' })
      resueltos.add(pend.id)
      hechos += 1
      await ctx.persist()
      continue
    }
    const intentos = (stepRetries.get(pend.id) ?? 0) + 1
    stepRetries.set(pend.id, intentos)
    if (intentos <= STEP_LOOP_DEFAULTS.maxQaRetries) {
      const issues = (gate.issues.length ? gate.issues : ['sin criterios de aceptación cumplidos']).join('\n- ')
      ctx.run.messages.push({
        role: 'user',
        content: `QA del paso ${pend.id} NO pasó:\n- ${issues}\nCorrige SOLO lo necesario y vuelve a terminar el paso con agent.complete.`,
      })
      ctx.log({ kind: 'note', stepId: pend.id, message: `QA del paso ${pend.id} falló; reintento ${intentos}`, status: 'retry' })
      continue
    }
    await writePlan(
      ctx,
      marcarPaso(plan2, pend.id, 'bloqueado', {
        motivoBloqueo: (gate.issues.length ? gate.issues : ['QA no pasó']).join('; '),
        evidencia: gate.evidencia,
      }),
    )
    upsertRunStep(ctx, pend, 'blocked', gate.evidencia)
    ctx.emit({ type: 'step.done', stepId: pend.id, status: 'blocked', evidence: gate.evidencia })
    ctx.log({ kind: 'note', stepId: pend.id, message: `paso ${pend.id} bloqueado`, status: 'blocked' })
    bloqueados.push(pend)
    resueltos.add(pend.id)
    await ctx.persist()
  }
}

/** Entrada del programa: rol director → programa multi-agente; create/auto con plan aprobado → orquesta pasos; resto → bucle libre. */
async function turnEntry(ctx: TurnContext, opts: Required<ToolLoopOptions>): Promise<TurnProgramOutcome> {
  if (ctx.run.role === DIRECTOR_PROGRAM_ID as EngineAgentRole) {
    const program = createDirectorProgram(opts)
    return program.run(ctx)
  }
  if (ctx.run.mode !== 'create' && ctx.run.mode !== 'auto') return loop(ctx, opts)
  return orchestrate(ctx, opts)
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
      return turnEntry(ctx, opts)
    },
    async answer(ctx, need: EngineNeed, answer: EngineAnswer) {
      const { run } = ctx
      if (need.kind === 'clarify' || need.kind === 'apply') {
        run.messages.push({ role: 'user', content: answer.text?.trim() || (answer.approved ? 'Sí, continúa.' : 'No.') })
        return turnEntry(ctx, opts)
      }
      const calls = run.pendingCalls?.length ? run.pendingCalls : need.calls
      run.pendingCalls = undefined
      if (!answer.approved) {
        for (const c of calls) run.messages.push(toolResultMessage(c, { status: 'rejected', error: { message: 'El usuario rechazó esta acción.' } }))
        if (answer.text?.trim()) run.messages.push({ role: 'user', content: answer.text.trim() })
        return turnEntry(ctx, opts)
      }
      if (need.kind === 'approve-plan') {
        run.planApproved = true
        // A4: la aprobación queda registrada en plan.md (borrador → aprobado,
        // revisión + 1); las Notas del usuario se conservan.
        const incoming = answer.plan?.trim() ? answer.plan : await ctx.readPlan()
        if (incoming && isStructuredPlan(incoming)) {
          const parsed = parsePlan(incoming)
          const aprobado = parsed ? (parsed.estadoPlan === 'aprobado' ? parsed : aprobarPlan(parsed)) : null
          const md = aprobado ? serializePlan(aprobado) : incoming
          await ctx.host.writeDoc?.('plan.md', md)
          if (run.input.planOverride) run.input.planOverride = md
          run.data = { ...(run.data ?? {}), planHash: planHash(md), planMd: md }
          ctx.emit({ type: 'plan.updated', plan: md })
        } else if (incoming) {
          await ctx.host.writeDoc?.('plan.md', incoming)
          ctx.emit({ type: 'plan.updated', plan: incoming })
        }
        const out = await processCalls(ctx, calls, opts.maxCallsPerIteration)
        if (out.need) return { status: 'needs-user', need: out.need, summary: out.need.message }
        return turnEntry(ctx, opts)
      }
      // confirm: el usuario aprobó destructivas/sistema explícitamente.
      const results = await ctx.executeTools(calls, { userConfirmed: true })
      for (const [i, r] of results.entries()) run.messages.push(toolResultMessage(calls[i]!, r))
      return turnEntry(ctx, opts)
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
      return turnEntry(ctx, opts)
    },
  }
}

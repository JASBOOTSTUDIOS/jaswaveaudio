/**
 * Programa de turno del Director (A6 · equipo multi-agente).
 *
 * El Director recibe un plan aprobado (A4/A5), recorre los pasos en orden y, por cada uno,
 * delega la ejecución al agente asignado (`paso.agente`: productor | mezcla | mastering | qa |
 * director) con herramientas con alcance de rol y el prompt de ese rol. Un paso termina cuando
 * el especialista emite `agent.complete`; entonces el Director aplica QA vía `audit.step`
 * (fail closed): `[x]` con evidencia, reintento hasta `maxQaRetries` o `[!]` bloqueado y sigue
 * con el siguiente paso. Al final cierra con `audit.project` (+ `audit.mix` si tocó mezcla/
 * mastering) y emite `session.summary` por paso.
 *
 * El plan se aprueba una sola vez (`approve-plan`). Las confirmaciones destructivas/sistema las
 * gestiona el programa del bucle (`createToolLoopProgram.answer`) reingresando por `turnEntry`.
 */

import { toolResultMessage } from './chat'
import { gateStepAudit, gateProjectAudit } from './audit-gate'
import {
  aprobarPlan,
  isStructuredPlan,
  marcarPaso,
  parsePlan,
  planHash,
  serializePlan,
  type PlanEstructurado,
  type PlanPaso,
} from '../plan/structured-plan'
export const DIRECTOR_PROGRAM_ID = 'director'

import {
  loop,
  auditPaso,
  instructionDePaso,
  stepMarkerOf,
  writePlan,
  upsertRunStep,
  STEP_LOOP_DEFAULTS,
  TOOL_LOOP_DEFAULTS,
  type ToolLoopOptions,
} from './tool-loop'
import type { TurnContext } from './turn-context'
import type {
  EngineAgentRole,
  EngineAnswer,
  EngineNeed,
  EngineProjectAudit,
  TurnProgram,
  TurnProgramOutcome,
} from './engine-types'

/** Entrada del turno del Director. */
async function directorTurnEntry(ctx: TurnContext, opts: Required<ToolLoopOptions>): Promise<TurnProgramOutcome> {
  const plan = await syncPlanState(ctx)
  if (!plan || plan.estadoPlan !== 'aprobado') {
    return {
      status: 'needs-user',
      need: {
        id: ctx.newId('need'),
        kind: 'approve-plan',
        message: 'Antes de ejecutar el plan necesito que lo apruebes (una sola vez).',
        calls: [],
        plan: (await ctx.readPlan()) ?? undefined,
      },
      summary: 'Esperando aprobación del plan.',
    }
  }
  return orchestrateDirector(ctx, opts)
}

/** Relee el plan (A4) sin efectos secundarios extra. */
async function syncPlanState(ctx: TurnContext): Promise<PlanEstructurado | null> {
  const md = await ctx.readPlan()
  if (!md || !isStructuredPlan(md)) return null
  const plan = parsePlan(md)
  if (!plan) return null
  if (plan.estadoPlan === 'aprobado') ctx.run.planApproved = true
  return plan
}

/** Ejecuta los pasos aprobados uno por uno, cada uno con su rol asignado. */
async function orchestrateDirector(ctx: TurnContext, opts: Required<ToolLoopOptions>): Promise<TurnProgramOutcome> {
  const first = await syncPlanState(ctx)
  if (!first || first.estadoPlan !== 'aprobado') {
    return { status: 'failed', error: 'El plan no está aprobado.' }
  }
  const tienePend = (p: PlanPaso) => p.estado === 'pendiente' || p.estado === 'en-curso'
  if (!first.pasos.some(tienePend)) return finishTurnDirector(ctx, 0, [], false)

  const stepRetries = new Map<string, number>()
  const resueltos = new Set<string>()
  let hechos = 0
  let snapshotTurno = false
  const bloqueados: PlanPaso[] = []
  let toqueMezclaMastering = false

  for (;;) {
    ctx.throwIfAborted()
    await syncPlanState(ctx)
    const md = await ctx.readPlan()
    const plan = md && isStructuredPlan(md) ? parsePlan(md) : null
    if (!plan || plan.estadoPlan !== 'aprobado') {
      return hechos || bloqueados.length ? finishTurnDirector(ctx, hechos, bloqueados, toqueMezclaMastering)
        : { status: 'failed', error: 'El plan dejó de estar aprobado.' }
    }
    const pend = plan.pasos.find((p) => tienePend(p) && !resueltos.has(p.id))
    if (!pend) return finishTurnDirector(ctx, hechos, bloqueados, toqueMezclaMastering)

    if (pend.agente === 'mezcla' || pend.agente === 'mastering') toqueMezclaMastering = true

    if (!snapshotTurno) {
      await ctx.captureSnapshot('turn')
      snapshotTurno = true
    }
    await ctx.captureSnapshot('step', pend.id)
    // El rol del paso determina las herramientas visibles y el prompt del especialista.
    const rolAnterior = ctx.run.role
    ctx.run.role = pend.agente as EngineAgentRole
    await writePlan(ctx, marcarPaso(plan, pend.id, 'en-curso'))
    upsertRunStep(ctx, pend, 'running')
    ctx.emit({ type: 'step.started', stepId: pend.id, title: pend.titulo, role: pend.agente as EngineAgentRole })
    ctx.log({ kind: 'note', stepId: pend.id, message: `paso ${pend.id} en curso: ${pend.titulo}` })
    ctx.run.messages.push({ role: 'user', content: instructionDePaso(pend) })
    await ctx.persist()

    const out = await loop(ctx, opts, { stopOnComplete: true })
    ctx.run.role = rolAnterior

    if (out.status === 'needs-user') return out
    const marker = stepMarkerOf(out.data)
    if (out.status === 'failed' && !marker) return out

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
      // session.summary por paso (A9) — el Director cierra el paso con una nota de avance.
      try {
        await ctx.executeTools([
          { id: ctx.newId('call'), name: 'session.summary', arguments: { stepId: pend.id, agente: pend.agente } },
        ])
      } catch {
        /* session.summary es informativo; no detiene el turno. */
      }
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

  return finishTurnDirector(ctx, hechos, bloqueados, toqueMezclaMastering)
}

/** Cierre del turno: `audit.project` (fail closed) + `audit.mix` si tocó mezcla/mastering. */
async function finishTurnDirector(
  ctx: TurnContext,
  hechos: number,
  bloqueados: PlanPaso[],
  toqueMezclaMastering: boolean,
): Promise<TurnProgramOutcome> {
  let auditoria: EngineProjectAudit | undefined
  if (ctx.host.auditProject) {
    try {
      auditoria = await ctx.host.auditProject({ runId: ctx.run.id })
    } catch (e) {
      auditoria = { ok: false, issues: [`QA del proyecto falló: ${e instanceof Error ? e.message : String(e)}`] }
    }
  }

  let mixAudit: EngineProjectAudit['mix'] | undefined
  if (toqueMezclaMastering) {
    try {
      const results = await ctx.executeTools([
        { id: ctx.newId('call'), name: 'audit.mix', arguments: {} },
      ])
      const r = results[0]
      if (r.status === 'success' && r.data) {
        const d = r.data as { cumpleCriterios?: boolean; incidencias?: Array<{ mensaje?: string }>; evidencia?: unknown[] }
        mixAudit = {
          ok: Boolean(d.cumpleCriterios),
          issues: (d.incidencias ?? []).map((i) => i.mensaje).filter((m): m is string => Boolean(m)),
          evidencia: Array.isArray(d.evidencia) ? d.evidencia.map(String) : [],
        }
      }
    } catch {
      /* audit.mix es informativo; si falla no se bloquea por él. */
    }
  }
  if (mixAudit) {
    auditoria = auditoria
      ? { ...auditoria, mix: mixAudit }
      : { ok: true, issues: [], warnings: [], acceptedIssues: [], mix: mixAudit }
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
  const resumen = [base, gate.warnings.length ? `Avisos: ${gate.warnings.join('; ')}` : ''].filter(Boolean).join(' · ')
  ctx.message(resumen, { final: true })
  return { status: 'completed', summary: resumen }
}

export function createDirectorProgram(options: ToolLoopOptions = {}): TurnProgram {
  const opts: Required<ToolLoopOptions> = { ...TOOL_LOOP_DEFAULTS, ...options }

  return {
    id: DIRECTOR_PROGRAM_ID,
    async run(ctx) {
      if (!ctx.run.messages.length) {
        for (const h of ctx.input.history ?? []) ctx.run.messages.push({ role: h.role, content: h.content })
        ctx.run.messages.push({ role: 'user', content: ctx.run.userText })
      }
      return directorTurnEntry(ctx, opts)
    },
    async answer(ctx, need, answer) {
      const { run } = ctx
      if (need.kind === 'clarify' || need.kind === 'apply') {
        run.messages.push({ role: 'user', content: answer.text?.trim() || (answer.approved ? 'Sí, continúa.' : 'No.') })
        return directorTurnEntry(ctx, opts)
      }
      const calls = run.pendingCalls?.length ? run.pendingCalls : need.calls
      run.pendingCalls = undefined
      if (!answer.approved) {
        for (const c of calls) {
          run.messages.push(toolResultMessage(c, { status: 'rejected', error: { message: 'El usuario rechazó esta acción.' } }))
        }
        if (answer.text?.trim()) run.messages.push({ role: 'user', content: answer.text.trim() })
        return directorTurnEntry(ctx, opts)
      }
      if (need.kind === 'approve-plan') {
        run.planApproved = true
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
        return directorTurnEntry(ctx, opts)
      }
      // confirm: el usuario aprobó explícitamente destructivas/sistema.
      const results = await ctx.executeTools(calls, { userConfirmed: true })
      for (const [i, r] of results.entries()) run.messages.push(toolResultMessage(calls[i]!, r))
      return directorTurnEntry(ctx, opts)
    },
    async resume(ctx) {
      const { run } = ctx
      const last = [...run.messages].reverse().find((m) => m.role === 'assistant')
      if (last && last.toolCalls?.length) {
        const answered = new Set(run.messages.filter((m) => m.role === 'tool').map((m) => (m as { toolCallId: string }).toolCallId))
        for (const c of last.toolCalls) {
          if (!answered.has(c.id)) {
            run.messages.push(toolResultMessage(c, { status: 'cancelled', error: { message: 'Interrumpida (recarga); verifica el estado antes de repetir.' } }))
          }
        }
      }
      if (!run.messages.length) return this.run(ctx)
      return directorTurnEntry(ctx, opts)
    },
  }
}

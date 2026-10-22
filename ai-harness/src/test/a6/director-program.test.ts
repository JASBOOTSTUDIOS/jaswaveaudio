import { describe, it, expect } from 'vitest'
import {
  createTurnEngine,
  drainTurn,
  type EngineAgentRole,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatRequest,
  type EngineToolSchema,
} from '../../engine'
import { parsePlan, serializePlan, aprobarPlan, type PlanEstructurado } from '../../plan/structured-plan'

function planMd(pasos: string[], estado: 'borrador' | 'aprobado' = 'aprobado'): string {
  return [
    '# Plan · Tema multi-agente',
    '',
    `> Objetivo: producir tema · Modo: create · Estado: ${estado} (2026-10-22) · Revisión: 1`,
    '',
    '## Pasos',
    ...pasos,
    '',
    '## Notas del usuario',
    'Referencia: funk a 110 bpm.',
  ].join('\n')
}

const PASOS = [
  '- [ ] S1 · Estructura · @productor — Crear pista de batería',
  '- [ ] S2 · Mezcla · @mezcla — Ajustar gain y pan',
  '- [ ] S3 · Mastering · @mastering — Normalizar master',
  '- [ ] S4 · QA · @qa — Verificar criterios finales',
]

type StepHostOpts = {
  initialPlan: string
  auditStep?: EngineHost['auditStep']
  auditProject?: EngineHost['auditProject']
}

function directorHost(opts: StepHostOpts) {
  let plan = opts.initialPlan
  let clock = 1_000_000
  const requests: EngineHostChatRequest[] = []
  const listToolsCalls: Array<{ mode: string; role: EngineAgentRole; tools: EngineToolSchema[] }> = []
  const writes: string[] = []
  const usedPaso = new Set<string>()

  const base: EngineToolSchema[] = [
    { name: 'session.summary', description: 'Resumen de sesión', parameters: { type: 'object', properties: {} } as Record<string, unknown> },
  ]
  const porRol: Record<string, string[]> = {
    director: ['plan.get', 'plan.status', 'track.list', 'selection.get'],
    productor: ['track.create', 'midi.clip.create', 'midi.notes.set'],
    mezcla: ['track.ganancia', 'pista.pan', 'send.set', 'analysis.mix', 'analysis.loudness'],
    mastering: ['master.update', 'analysis.loudness', 'analysis.spectrum'],
    qa: ['analysis.loudness', 'audit.step', 'audit.project', 'run.log'],
  }

  const host: EngineHost = {
    now: () => (clock += 5),
    buildSystemPrompt: ({ mode, role }) => `Eres el ${role}. Modo ${mode}.`,
    listTools: ({ mode, role }) => {
      const tools = (porRol[role] ?? []).map((n) => ({ name: n, description: n, parameters: { type: 'object', properties: {} } as Record<string, unknown> })).concat(base)
      listToolsCalls.push({ mode, role, tools })
      return tools
    },
    async chat(req, copts) {
      requests.push(req)
      copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const paso = /paso (S\d+)/.exec(lastUser)?.[1] ?? 'S0'
      if (usedPaso.has(paso)) {
        return { success: true, content: `Listo: ${paso} terminado.`, usedModel: 'mock' }
      }
      usedPaso.add(paso)
      return {
        success: true,
        content: `Trabajo ${paso}.`,
        toolCalls: [{ id: `t_${paso}`, name: 'track.create', arguments: { nombre: paso } }],
        usedModel: 'mock',
      }
    },
    async executeTools(calls) {
      return calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, data: { ok: true } }))
    },
    readDoc: (slug) => (slug === 'plan.md' ? plan : null),
    writeDoc: (slug, content) => {
      if (slug === 'plan.md') {
        plan = content
        writes.push(content)
      }
    },
    auditStep: opts.auditStep,
    auditProject: opts.auditProject,
  }
  return { host, requests, listToolsCalls, writes, getPlan: () => plan }
}

async function collect(handle: ReturnType<ReturnType<typeof createTurnEngine>['runTurn']>) {
  const events: EngineEvent[] = []
  const result = await drainTurn(handle, (e) => events.push(e))
  return { events, result }
}

function aprobado(md: string): string {
  const p = parsePlan(md) as PlanEstructurado
  return serializePlan(aprobarPlan(p, '2026-10-22'))
}

describe('A6 · Director multi-agente (ejecución por rol asignado)', () => {
  it('ejecuta pasos con el rol asignado; QA ok → todos [x]; resumen final', async () => {
    const { host, requests, listToolsCalls, getPlan } = directorHost({ initialPlan: aprobado(planMd(PASOS)) })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'produce el tema según el plan', mode: 'create', conversationId: 'c1', role: 'director' }),
    )
    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Plan completado: 4')
    expect(result.summary).not.toContain('Bloqueados')

    const starts = events.filter((e) => e.type === 'step.started')
    expect(starts.map((e) => e.stepId)).toEqual(['S1', 'S2', 'S3', 'S4'])
    expect(starts.map((e) => e.role)).toEqual(['productor', 'mezcla', 'mastering', 'qa'])
    expect(events.filter((e) => e.type === 'step.done' && e.status === 'done')).toHaveLength(4)

    const rolesPid = listToolsCalls.map((c) => c.role)
    expect(rolesPid).toContain('productor')
    expect(rolesPid).toContain('mezcla')
    expect(rolesPid).toContain('mastering')
    expect(rolesPid).toContain('qa')

    const final = parsePlan(getPlan())!
    expect(final.pasos.every((p) => p.estado === 'hecho')).toBe(true)
  })

  it('mezcla solo recibe herramientas de su rol (track.create filtrado)', async () => {
    const { host, listToolsCalls } = directorHost({
      initialPlan: aprobado(planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance'])),
    })
    const engine = createTurnEngine(host)
    await collect(
      engine.runTurn({ text: 'mezcla la batería', mode: 'create', conversationId: 'c1', role: 'director' }),
    )
    const mezclaCalls = listToolsCalls.filter((c) => c.role === 'mezcla')
    expect(mezclaCalls.length).toBeGreaterThan(0)
    for (const c of mezclaCalls) {
      expect(c.tools.map((t) => t.name)).not.toContain('track.create')
      expect(c.tools.map((t) => t.name)).toContain('track.ganancia')
    }
  })

  it('QA sin evidencia y con criterios → paso [!] bloqueado; el turno sigue con el siguiente', async () => {
    const { host, getPlan } = directorHost({
      initialPlan: aprobado(planMd(PASOS.slice(0, 2))),
      auditStep: (req) =>
        req.step.id === 'S2' ? { ok: false, issues: ['sin medición de gain staging'] } : { ok: true, evidencia: ['ok'] },
    })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'estructura y mezcla', mode: 'create', conversationId: 'c1', role: 'director' }),
    )
    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Bloqueados: S2')
    expect(events.some((e) => e.type === 'step.done' && e.stepId === 'S2' && e.status === 'blocked')).toBe(true)
    expect(events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'done')).toBe(true)
    const final = parsePlan(getPlan())!
    expect(final.pasos.find((p) => p.id === 'S2')!.estado).toBe('bloqueado')
  })

  it('plan sin aprobar → pide approve-plan; tras aprobar ejecuta los pasos', async () => {
    const { host, writes, getPlan } = directorHost({
      initialPlan: planMd(PASOS.slice(0, 1), 'borrador'),
    })
    const engine = createTurnEngine(host)
    const first = await collect(
      engine.runTurn({ text: 'crea la batería', mode: 'create', conversationId: 'c1', role: 'director' }),
    )
    expect(first.result.status).toBe('waiting-user')
    expect(first.result.run.pending?.kind).toBe('approve-plan')
    expect(writes).toHaveLength(0)
    expect(first.events.some((e) => e.type === 'step.started')).toBe(false)

    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(second.result.status).toBe('completed')
    expect(writes.length).toBeGreaterThan(0)
    const final = parsePlan(getPlan())!
    expect(final.pasos[0]!.estado).toBe('hecho')
  })

  it('audit.project con incidencias → el turno falla y no cierra', async () => {
    const { host, getPlan } = directorHost({
      initialPlan: aprobado(planMd(['- [ ] S1 · Mezcla · @mezcla — Ajustar balance'])),
      auditProject: () => ({ ok: false, issues: ['True Peak 0.3 dBTP'] }),
    })
    const engine = createTurnEngine(host)
    const { result } = await collect(
      engine.runTurn({ text: 'ajusta el balance', mode: 'create', conversationId: 'c1', role: 'director' }),
    )
    expect(result.status).toBe('failed')
    expect(result.run.error).toContain('QA del proyecto no pasó')
    expect(result.run.error).toContain('True Peak 0.3 dBTP')
  })
})

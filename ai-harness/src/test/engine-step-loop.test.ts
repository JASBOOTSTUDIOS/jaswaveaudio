import { describe, it, expect } from 'vitest'
import {
  createTurnEngine,
  drainTurn,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatRequest,
  type EngineStepAudit,
} from '../engine'
import { parsePlan, serializePlan, aprobarPlan, type PlanEstructurado } from '../plan/structured-plan'

function planMd(pasos: string[], estado: 'borrador' | 'aprobado' = 'aprobado'): string {
  return [
    '# Plan · Proyecto completo',
    '',
    `> Objetivo: construir tema · Modo: create · Estado: ${estado} (2026-10-20) · Revisión: 3`,
    '',
    '## Pasos',
    ...pasos,
    '',
    '## Notas del usuario',
    'Quiero algo enérgico.',
  ].join('\n')
}

const PASOS_6 = [
  '- [ ] S1 · Estructura · @coproductor — Crear pista Batería',
  '- [ ] S2 · Estructura · @coproductor — Crear pista Bajo',
  '- [ ] S3 · Armonía · @coproductor — Acorde de pad',
  '- [ ] S4 · Melodía · @coproductor — Melodía principal',
  '- [ ] S5 · Mezcla · @mezcla — Balance de volúmenes',
  '- [ ] S6 · QA · @qa — Revisión final',
]

type StepHostOpts = {
  initialPlan: string
  auditStep?: EngineHost['auditStep']
  auditProject?: EngineHost['auditProject']
  captureSnapshot?: EngineHost['captureSnapshot']
  restoreSnapshot?: EngineHost['restoreSnapshot']
  budget?: EngineHost['budget']
  /** toolCalls por paso; la segunda vez que se habla del paso → prosa (fin de paso). */
  toolsPorPaso?: boolean
}

/** Host de paso: el modelo crea algo en el 1er chat del paso y cierra con prosa en el 2º. */
function stepHost(opts: StepHostOpts) {
  let plan = opts.initialPlan
  let clock = 1_000_000
  const requests: EngineHostChatRequest[] = []
  const used = new Set<string>()
  const writes: string[] = []
  const host: EngineHost = {
    now: () => (clock += 5),
    buildSystemPrompt: ({ mode }) => `Eres el coproductor. Modo ${mode}.`,
    listTools: () => [
      { name: 'track.create', description: 'Crea pista', parameters: { type: 'object', properties: { nombre: { type: 'string' } } } },
      { name: 'track.delete', description: 'Borra pista', parameters: { type: 'object', properties: { trackId: { type: 'string' } } } },
      { name: 'track.list', description: 'Lista pistas', parameters: { type: 'object', properties: {} } },
    ],
    async chat(req, copts) {
      requests.push(req)
      copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
      const paso = /paso (S\d+)/.exec(lastUser)?.[1] ?? 'S0'
      if (opts.toolsPorPaso === false || used.has(paso)) {
        return { success: true, content: `Listo: ${paso} terminado.`, usedModel: 'mock' }
      }
      used.add(paso)
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
    captureSnapshot: opts.captureSnapshot,
    restoreSnapshot: opts.restoreSnapshot,
    budget: opts.budget,
  }
  return { host, requests, writes, getPlan: () => plan }
}

async function collect(handle: ReturnType<ReturnType<typeof createTurnEngine>['runTurn']>) {
  const events: EngineEvent[] = []
  const result = await drainTurn(handle, (e) => events.push(e))
  return { events, result }
}

function aprobado(md: string): string {
  const p = parsePlan(md) as PlanEstructurado
  return serializePlan(aprobarPlan(p, '2026-10-20'))
}

describe('engine · ejecución del plan paso a paso (A5)', () => {
  it('ejecuta 6 pasos sin intervención: QA ok por defecto, todos [x] y resumen final', async () => {
    const { host, requests, getPlan } = stepHost({ initialPlan: aprobado(planMd(PASOS_6)) })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'construye el tema entero según el plan', mode: 'create', conversationId: 'c1' }),
    )
    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Plan completado: 6')
    expect(result.summary).not.toContain('Bloqueados')
    const starts = events.filter((e) => e.type === 'step.started').map((e) => e.stepId)
    expect(starts).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    expect(events.filter((e) => e.type === 'step.done' && e.status === 'done')).toHaveLength(6)
    const final = parsePlan(getPlan())!
    expect(final.pasos.every((p) => p.estado === 'hecho')).toBe(true)
    expect(final.notasUsuario).toContain('Quiero algo enérgico.')
    // La instrucción del paso se siembra en el hilo (no hay «¿te gustó?» al final).
    const instr = requests[0]!.messages.find((m) => m.role === 'user' && m.content.includes('Trabaja AHORA el paso S1'))
    expect(instr).toBeTruthy()
    const lastMsgs = requests[requests.length - 1]!.messages.map((m) => m.content).join('\n')
    expect(lastMsgs).not.toContain('gustó')
    // 6 pasos × 2 chats (tool + prosa).
    expect(requests).toHaveLength(12)
  })

  it('QA falla 1 vez → reintento del MISMO paso y queda [x] con evidencia', async () => {
    let auditsS1 = 0
    const { host, requests, getPlan } = stepHost({
      initialPlan: aprobado(planMd(PASOS_6.slice(0, 2))),
      auditStep: (req) => {
        if (req.step.id !== 'S1') return { ok: true }
        auditsS1 += 1
        return auditsS1 === 1 ? { ok: false, issues: ['la pista Batería no suena'] } : { ok: true, evidencia: ['Batería suena a 1.8 notas/beat'] }
      },
    })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'crea las dos pistas', mode: 'create', conversationId: 'c1' }),
    )
    expect(result.status).toBe('completed')
    expect(auditsS1).toBe(2)
    expect(events.filter((e) => e.type === 'step.started' && e.stepId === 'S1')).toHaveLength(2)
    expect(events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'done')).toBe(true)
    const final = parsePlan(getPlan())!
    expect(final.pasos.find((p) => p.id === 'S1')!.estado).toBe('hecho')
    expect(final.pasos.find((p) => p.id === 'S1')!.evidencia.join(' ')).toContain('notas/beat')
    // El modelo recibió el veredicto de QA en el hilo.
    expect(requests.some((r) => r.messages.some((m) => m.content.includes('QA del paso S1 NO pasó')))).toBe(true)
  })

  it('QA falla siempre → paso [!] bloqueado con motivo y el turno SIGUE con el siguiente', async () => {
    const { host, getPlan } = stepHost({
      initialPlan: aprobado(planMd(PASOS_6.slice(0, 2))),
      auditStep: (req) =>
        req.step.id === 'S1' ? { ok: false, issues: ['el volumen está a -60 dB'] } : { ok: true, evidencia: ['ok'] },
    })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'crea las dos pistas', mode: 'create', conversationId: 'c1' }),
    )
    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Bloqueados: S1')
    expect(events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'blocked')).toBe(true)
    expect(events.some((e) => e.type === 'step.done' && e.stepId === 'S2' && e.status === 'done')).toBe(true)
    const final = parsePlan(getPlan())!
    expect(final.pasos.find((p) => p.id === 'S1')!.estado).toBe('bloqueado')
    expect(final.pasos.find((p) => p.id === 'S1')!.motivoBloqueo).toContain('-60 dB')
    expect(final.pasos.find((p) => p.id === 'S2')!.estado).toBe('hecho')
  })

  it('confirmación destructiva a mitad de paso: espera, se aprueba y el paso termina', async () => {
    let charlas = 0
    const { host, getPlan } = stepHost({ initialPlan: aprobado(planMd(['- [ ] S1 · Estructura · @coproductor — Borrar pista vieja'])) })
    const baseChat = host.chat!
    host.chat = async (req, copts) => {
      charlas += 1
      // 1ª charla: destructiva; tras confirmar: prosa de cierre.
      if (charlas === 1) {
        copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
        return {
          success: true,
          content: 'Borro la pista vieja.',
          toolCalls: [{ id: 't_del', name: 'track.delete', arguments: { trackId: 'vieja_01' } }],
          usedModel: 'mock',
        }
      }
      return baseChat(req, copts)
    }
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'borra la pista vieja del plan', mode: 'create', conversationId: 'c1' }))
    expect(first.result.status).toBe('waiting-user')
    expect(first.result.run.pending?.kind).toBe('confirm')
    // El paso quedó en-curso antes de esperar confirmación.
    expect(parsePlan(getPlan())!.pasos[0]!.estado).toBe('en-curso')
    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(second.result.status).toBe('completed')
    expect(second.events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'done')).toBe(true)
    expect(parsePlan(getPlan())!.pasos[0]!.estado).toBe('hecho')
  })

  it('undoStep/undoTurn restauran los snapshots del host (LIFO)', async () => {
    const restored: unknown[] = []
    let snaps = 0
    const { host } = stepHost({
      initialPlan: aprobado(planMd(PASOS_6.slice(0, 2))),
      captureSnapshot: (req) => ({ ...req, n: (snaps += 1) }),
      restoreSnapshot: (snap) => {
        restored.push(snap)
      },
    })
    const engine = createTurnEngine(host)
    const { result } = await collect(engine.runTurn({ text: 'crea las dos pistas', mode: 'create', conversationId: 'c1' }))
    expect(result.status).toBe('completed')
    expect(snaps).toBe(3) // turno + S1 + S2
    expect(await engine.undoStep(result.runId)).toBe(true)
    expect(await engine.undoStep(result.runId)).toBe(true)
    expect(await engine.undoTurn(result.runId)).toBe(true)
    expect(restored.map((s) => (s as { kind: string; stepId?: string }).kind)).toEqual(['step', 'step', 'turn'])
    expect((restored[0] as { stepId?: string }).stepId).toBe('S2')
    // Ya no queda nada que deshacer.
    expect(await engine.undoStep(result.runId)).toBe(false)
  })

  it('presupuesto agotado a mitad del plan: el turno falla con reason budget (no sigue gastando)', async () => {
    const { host, getPlan } = stepHost({
      initialPlan: aprobado(planMd(PASOS_6.slice(0, 3))),
      budget: { maxModelCalls: 3 },
    })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: 'construye las tres fases', mode: 'create', conversationId: 'c1' }),
    )
    expect(result.status).toBe('failed')
    const last = events[events.length - 1]!
    expect(last.type === 'turn.failed' && last.reason).toBe('budget')
    expect(result.run.budget.modelCalls).toBe(3)
    // El paso interrumpido no se marca hecho (S1 sí terminó antes de agotarse).
    const trasCorte = parsePlan(getPlan())!
    expect(trasCorte.pasos.find((p) => p.id === 'S1')!.estado).toBe('hecho')
    expect(trasCorte.pasos.find((p) => p.id === 'S2')!.estado).not.toBe('hecho')
  })

  it('sin plan aprobado (borrador) no orquesta: pide aprobación como antes', async () => {
    const { host, writes } = stepHost({ initialPlan: planMd(PASOS_6.slice(0, 1), 'borrador') })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(engine.runTurn({ text: 'crea la batería', mode: 'create', conversationId: 'c1' }))
    expect(result.status).toBe('waiting-user')
    expect(result.run.pending?.kind).toBe('approve-plan')
    expect(writes).toHaveLength(0)
    expect(events.some((e) => e.type === 'step.started')).toBe(false)
  })
})

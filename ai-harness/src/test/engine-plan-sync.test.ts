import { describe, it, expect } from 'vitest'
import {
  createTurnEngine,
  createMockPlayer,
  drainTurn,
  parseMockScript,
  type EngineEvent,
  type EngineHost,
} from '../engine'
import { parsePlan, serializePlan, aprobarPlan, type PlanEstructurado } from '../plan/structured-plan'

const PLAN_BORRADOR = [
  '# Plan · Crear pad',
  '',
  '> Objetivo: añadir pad · Modo: create · Estado: borrador (2026-10-20) · Revisión: 1',
  '',
  '## Pasos',
  '- [ ] S1 · Estructura · @coproductor — Crear pista Pad',
  '  - criterio: la pista Pad existe',
  '',
  '## Notas del usuario',
  'Que suene cálido.',
].join('\n')

const SCRIPT = parseMockScript({
  name: 'crea pad y termina',
  responses: [
    {
      when: { purpose: 'agent', afterToolResult: false },
      content: 'Creo la pista Pad.',
      toolCalls: [{ name: 'track.create', arguments: { nombre: 'Pad' } }],
    },
    // A5: tras aprobar, el motor ejecuta el paso S1 y esta prosa lo cierra (QA asume ok).
    { content: 'Listo: pista Pad creada.' },
    { content: 'Escribo el MIDI del pad.' },
  ],
})

function planHost(initial: string, opts?: { readImpl?: EngineHost['readDoc'] }) {
  let plan = initial
  const writes: string[] = []
  const host: EngineHost = {
    now: () => Date.now(),
    buildSystemPrompt: ({ mode }) => `Eres el coproductor. Modo ${mode}.`,
    listTools: () => [
      { name: 'track.create', description: 'Crea pista', parameters: { type: 'object', properties: { nombre: { type: 'string' } } } },
    ],
    async chat() {
      throw new Error('chat no inyectado en esta prueba')
    },
    async executeTools(calls) {
      return calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, data: { ok: true } }))
    },
    readDoc: (slug) => {
      if (slug !== 'plan.md') return null
      if (opts?.readImpl) return opts.readImpl(slug)
      return plan
    },
    writeDoc: (slug, content) => {
      if (slug === 'plan.md') {
        plan = content
        writes.push(content)
      }
    },
  }
  return { host, writes, getPlan: () => plan }
}

async function collect(handle: ReturnType<ReturnType<typeof createTurnEngine>['runTurn']>) {
  const events: EngineEvent[] = []
  const result = await drainTurn(handle, (e) => events.push(e))
  return { events, result }
}

describe('engine · plan estructurado (A4)', () => {
  it('el plan aprobado en plan.md permite mutar sin pedir aprobación', async () => {
    const aprobado = serializePlan(aprobarPlan(parsePlan(PLAN_BORRADOR) as PlanEstructurado, '2026-10-20'))
    const player = createMockPlayer(SCRIPT)
    const { host } = planHost(aprobado)
    host.chat = async (req, copts) => {
      copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
      return { ...player.next({ messages: req.messages, hasTools: Boolean(req.tools?.length), purpose: req.meta.purpose, role: req.meta.role }), usedModel: 'mock' }
    }
    const engine = createTurnEngine(host)
    const r = await collect(engine.runTurn({ text: 'crea el pad del plan', mode: 'create', conversationId: 'c1' }))
    expect(r.result.status).toBe('completed')
    expect(r.result.run.planApproved).toBe(true)
    expect(r.events.some((e) => e.type === 'tool.result' && e.result.name === 'track.create' && e.result.status === 'success')).toBe(true)
    expect(r.events.some((e) => e.type === 'needs-user')).toBe(false)
  })

  it('el borrador pide aprobación y al aprobar queda registrado en plan.md (rev +1, notas intactas)', async () => {
    const player = createMockPlayer(SCRIPT)
    const { host, writes, getPlan } = planHost(PLAN_BORRADOR)
    host.chat = async (req, copts) => {
      copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
      return { ...player.next({ messages: req.messages, hasTools: Boolean(req.tools?.length), purpose: req.meta.purpose, role: req.meta.role }), usedModel: 'mock' }
    }
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'crea el pad del plan', mode: 'create', conversationId: 'c1' }))
    expect(first.result.status).toBe('waiting-user')
    expect(first.result.run.pending?.kind).toBe('approve-plan')
    expect(writes).toHaveLength(0)

    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    // A5: al aprobar, el motor ejecuta el paso S1 (QA asume ok sin host.auditStep) y cierra el turno.
    expect(second.result.status).toBe('completed')
    const trasAprobar = parsePlan(getPlan())!
    expect(trasAprobar.estadoPlan).toBe('aprobado')
    expect(trasAprobar.revision).toBe(2)
    expect(trasAprobar.notasUsuario).toContain('Que suene cálido.')
    expect(trasAprobar.pasos[0]!.estado).toBe('hecho')
    expect(second.events.some((e) => e.type === 'plan.updated' && e.plan?.includes('Estado: aprobado'))).toBe(true)
    expect(second.events.some((e) => e.type === 'step.started' && e.stepId === 'S1')).toBe(true)
    expect(second.events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'done')).toBe(true)
  })

  it('si el usuario edita plan.md a mitad de turno se emite plan.updated con el diff', async () => {
    const base = aprobarPlan(parsePlan(PLAN_BORRADOR) as PlanEstructurado, '2026-10-20')
    let md = serializePlan(base)
    let reads = 0
    const player = createMockPlayer(SCRIPT)
    const { host } = planHost('', {
      readImpl: () => {
        reads += 1
        // Antes de la 2ª iteración el usuario añade un paso al plan (ya aprobado).
        if (reads >= 2) {
          md = serializePlan({
            ...base,
            pasos: [
              ...base.pasos,
              { id: 'S2', fase: 'Estructura', agente: 'coproductor', titulo: 'Escribir MIDI del pad', estado: 'pendiente', criterios: [], herramientas: [], evidencia: [] },
            ],
          })
        }
        return md
      },
    })
    host.chat = async (req, copts) => {
      copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })
      return { ...player.next({ messages: req.messages, hasTools: Boolean(req.tools?.length), purpose: req.meta.purpose, role: req.meta.role }), usedModel: 'mock' }
    }
    const engine = createTurnEngine(host)
    const r = await collect(engine.runTurn({ text: 'crea el pad del plan', mode: 'create', conversationId: 'c1' }))
    expect(r.result.status).toBe('completed')
    const planEvents = r.events.filter((e) => e.type === 'plan.updated')
    expect(planEvents.length).toBeGreaterThanOrEqual(2)
    const diff = planEvents.find((e) => e.type === 'plan.updated' && e.diff)
    expect(diff).toBeTruthy()
    expect((diff as { diff?: { added?: { id: string }[] } }).diff?.added?.map((p) => p.id)).toContain('S2')
    // La aprobación del usuario en el archivo también manda: sin need.
    expect(r.events.some((e) => e.type === 'needs-user')).toBe(false)
    expect(r.result.run.planApproved).toBe(true)
    // A5: el paso añadido a mitad de turno también se ejecuta (S1 y S2 terminados).
    expect(r.events.some((e) => e.type === 'step.done' && e.stepId === 'S1' && e.status === 'done')).toBe(true)
    expect(r.events.some((e) => e.type === 'step.done' && e.stepId === 'S2' && e.status === 'done')).toBe(true)
  })
})

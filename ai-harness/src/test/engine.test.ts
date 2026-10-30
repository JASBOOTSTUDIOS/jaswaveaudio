import { describe, it, expect } from 'vitest'
import askFixture from './fixtures/engine-ask.json'
import createFixture from './fixtures/engine-create.json'
import markersFixture from './fixtures/engine-markers.json'
import {
  createTurnEngine,
  drainTurn,
  createMockPlayer,
  parseMockScript,
  parseEngineRun,
  serializeEngineRun,
  ensureSystemRules,
  toMarkerMessages,
  gateToolForMode,
  modeCapabilities,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatRequest,
  type EngineRun,
  type EngineToolCall,
  type MockScript,
} from '../engine'
import { UNTRUSTED_TOOL_DATA_RULE } from '../agent/untrusted'
import { agentDecisionFromChatResponse, agentDecisionFromToolCalls } from '../recovery/parse-agent-decision'

const FIXTURES: Record<string, unknown> = {
  'engine-ask.json': askFixture,
  'engine-create.json': createFixture,
  'engine-markers.json': markersFixture,
}

function fixture(name: string): MockScript {
  return parseMockScript(JSON.parse(JSON.stringify(FIXTURES[name])))
}

type FakeHostOpts = {
  script?: MockScript
  store?: Map<string, string>
  /** Intentos simulados por chat (fallback de modelos). */
  attemptsPerChat?: number
  chatImpl?: EngineHost['chat']
  budget?: EngineHost['budget']
}

function fakeHost(opts: FakeHostOpts = {}) {
  let clock = 1_000_000
  const player = opts.script ? createMockPlayer(opts.script) : null
  const requests: EngineHostChatRequest[] = []
  const executed: EngineToolCall[] = []
  const store = opts.store ?? new Map<string, string>()
  const host: EngineHost = {
    now: () => (clock += 5),
    buildSystemPrompt: ({ mode }) => `Eres el coproductor de JasWave. Modo ${mode}.`,
    listTools: () => [
      { name: 'track.list', description: 'Lista pistas', parameters: { type: 'object', properties: {} } },
      { name: 'track.create', description: 'Crea pista', parameters: { type: 'object', properties: { nombre: { type: 'string' } } } },
      { name: 'project.setBpm', description: 'Tempo', parameters: { type: 'object', properties: { bpm: { type: 'number' } } } },
      { name: 'track.delete', description: 'Borra pista', parameters: { type: 'object', properties: { trackId: { type: 'string' } } } },
    ],
    async chat(req, copts) {
      requests.push(req)
      if (opts.chatImpl) return opts.chatImpl(req, copts)
      const n = opts.attemptsPerChat ?? 1
      for (let i = 0; i < n; i++) {
        if (!copts.beforeAttempt({ index: i, total: n, label: `m${i}` })) {
          return { success: false, error: 'budget' }
        }
      }
      const r = player!.next({
        messages: req.messages,
        hasTools: Boolean(req.tools?.length),
        purpose: req.meta.purpose,
        role: req.meta.role,
      })
      return { ...r, usedModel: 'mock' }
    },
    async executeTools(calls) {
      executed.push(...calls)
      return calls.map((c) => ({
        callId: c.id,
        name: c.name,
        status: 'success' as const,
        data: c.name === 'track.list' ? [{ id: 'bass_01', nombre: 'Bajo' }] : { ok: true },
      }))
    },
    readDoc: (slug) => (slug === 'plan.md' ? '# Plan\n- [ ] S1 · Pad' : null),
    async persistRun(run) {
      store.set(run.id, serializeEngineRun(run))
    },
    async loadRun(id) {
      const raw = store.get(id)
      return raw ? parseEngineRun(raw) : null
    },
    budget: opts.budget,
  }
  return { host, requests, executed, store }
}

async function collect(handle: ReturnType<ReturnType<typeof createTurnEngine>['runTurn']>) {
  const events: EngineEvent[] = []
  const result = await drainTurn(handle, (e) => events.push(e))
  return { events, result }
}

describe('engine · turno ask', () => {
  it('lee, rechaza la mutación (guarda de modo) y termina con resumen', async () => {
    const { host, executed, requests } = fakeHost({ script: fixture('engine-ask.json') })
    const engine = createTurnEngine(host)
    const { events, result } = await collect(
      engine.runTurn({ text: '¿qué pistas hay?', mode: 'ask', conversationId: 'c1' }),
    )
    expect(result.status).toBe('completed')
    expect(result.summary).toContain('Bajo')
    expect(executed.map((c) => c.name)).toEqual(['track.list'])
    const rejected = events.filter((e) => e.type === 'tool.result' && e.result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    // Las tools visibles en ask son solo lecturas + control.
    const toolNames = requests[0]!.tools!.map((t) => t.name)
    expect(toolNames).toContain('track.list')
    expect(toolNames).not.toContain('track.create')
    expect(toolNames).toContain('agent.complete')
    // Siempre hay system prompt con la regla de datos no confiables y el plan.
    for (const r of requests) {
      expect(r.messages[0]!.role).toBe('system')
      expect(r.messages[0]!.content).toContain(UNTRUSTED_TOOL_DATA_RULE)
      expect(r.messages[0]!.content).toContain('## Plan actual')
    }
    // Resultados de herramientas como mensajes tool no confiables.
    const toolMsgs = requests[1]!.messages.filter((m) => m.role === 'tool')
    expect(toolMsgs.length).toBe(2)
    for (const m of toolMsgs) expect(m.content).toContain('untrusted="true"')
    expect(events[0]!.type).toBe('turn.started')
    expect(events[events.length - 1]!.type).toBe('turn.done')
  })
})

describe('engine · turno create', () => {
  it('sin plan aprobado pide aprobación una vez, luego confirma la destructiva y termina', async () => {
    const { host, executed } = fakeHost({ script: fixture('engine-create.json') })
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'añade un pad', mode: 'create', conversationId: 'c1' }))
    expect(first.result.status).toBe('waiting-user')
    expect(first.result.run.pending?.kind).toBe('approve-plan')
    expect(executed).toHaveLength(0)

    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(second.result.status).toBe('waiting-user')
    expect(second.result.run.pending?.kind).toBe('confirm')
    expect(executed.map((c) => c.name)).toEqual(['track.create', 'project.setBpm'])

    const third = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(third.result.status).toBe('completed')
    expect(executed.map((c) => c.name)).toEqual(['track.create', 'project.setBpm', 'track.delete'])
    expect(third.result.run.planApproved).toBe(true)
    expect(third.result.run.log.some((l) => l.kind === 'tool' && l.tool === 'track.delete' && l.status === 'success')).toBe(true)
  })

  it('con plan aprobado (placeholder) ejecuta escrituras sin pedir aprobación', async () => {
    const { host, executed } = fakeHost({ script: fixture('engine-create.json') })
    const engine = createTurnEngine(host)
    const first = await collect(
      engine.runTurn({ text: 'añade un pad', mode: 'create', conversationId: 'c1', planApproved: true }),
    )
    expect(first.result.run.pending?.kind).toBe('confirm')
    expect(executed.map((c) => c.name)).toEqual(['track.create', 'project.setBpm'])
    const rejected = await collect(engine.answer(first.result.runId, { approved: false }))
    expect(rejected.result.status).toBe('completed')
    expect(executed.map((c) => c.name)).not.toContain('track.delete')
  })

  it('auto aprueba el plan solo', async () => {
    const { host, executed } = fakeHost({ script: fixture('engine-create.json') })
    const engine = createTurnEngine(host)
    const r = await collect(engine.runTurn({ text: 'añade un pad', mode: 'auto', conversationId: 'c1' }))
    expect(r.result.run.pending?.kind).toBe('confirm')
    expect(executed).toHaveLength(2)
  })
})

describe('engine · cancelación y pausa', () => {
  const hangingChat: EngineHost['chat'] = (_req, opts) =>
    new Promise((resolve) => {
      opts.beforeAttempt({ index: 0, total: 1, label: 'm' })
      opts.signal.addEventListener('abort', () => resolve({ success: false, error: 'abort' }), { once: true })
    })

  it('cancel() termina el turno como cancelado', async () => {
    const { host } = fakeHost({ chatImpl: hangingChat })
    const engine = createTurnEngine(host)
    const handle = engine.runTurn({ text: 'hola', mode: 'ask', conversationId: 'c1' })
    setTimeout(() => engine.cancel(handle.runId), 10)
    const { events, result } = await collect(handle)
    expect(result.status).toBe('cancelled')
    const last = events[events.length - 1]!
    expect(last.type === 'turn.failed' && last.reason === 'cancelled').toBe(true)
  })

  it('pause() deja el run reanudable', async () => {
    const store = new Map<string, string>()
    const { host } = fakeHost({ chatImpl: hangingChat, store })
    const engine = createTurnEngine(host)
    const handle = engine.runTurn({ text: '¿qué pistas hay?', mode: 'ask', conversationId: 'c1' })
    setTimeout(() => engine.pause(handle.runId), 10)
    const { result } = await collect(handle)
    expect(result.status).toBe('paused')

    const resumed = fakeHost({ script: fixture('engine-ask.json'), store })
    const engine2 = createTurnEngine(resumed.host)
    const r2 = await collect(engine2.resume(handle.runId))
    expect(r2.result.status).toBe('completed')
  })
})

describe('engine · reanudación desde run persistido', () => {
  it('un run en espera sobrevive a un motor nuevo (recarga) y continúa', async () => {
    const store = new Map<string, string>()
    const a = fakeHost({ script: fixture('engine-create.json'), store })
    const first = await collect(createTurnEngine(a.host).runTurn({ text: 'añade un pad', mode: 'create', conversationId: 'c1' }))
    expect(first.result.status).toBe('waiting-user')
    const persisted = parseEngineRun(store.get(first.result.runId)!) as EngineRun
    expect(persisted.status).toBe('waiting-user')
    expect(persisted.pending?.kind).toBe('approve-plan')
    expect(persisted.budget.modelCalls).toBe(1)

    // «Recarga»: motor nuevo, mismo almacén; el guion continúa desde la 2.ª respuesta.
    const script = fixture('engine-create.json')
    const b = fakeHost({ script: { ...script, responses: script.responses.slice(1) }, store })
    const engine2 = createTurnEngine(b.host)
    const second = await collect(engine2.answer(first.result.runId, { approved: true }))
    expect(second.result.run.pending?.kind).toBe('confirm')
    expect(b.executed.map((c) => c.name)).toEqual(['track.create', 'project.setBpm'])
    // El hilo previo se reenvía al modelo (no se pierde contexto).
    expect(b.requests[0]!.messages.some((m) => m.role === 'assistant')).toBe(true)
    // El presupuesto no se regala al reanudar.
    expect(second.result.run.budget.modelCalls).toBe(2)
  })

  it('answer con needId incorrecto falla sin ejecutar nada', async () => {
    const { host, executed } = fakeHost({ script: fixture('engine-create.json') })
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'pad', mode: 'create', conversationId: 'c1' }))
    const r = await collect(engine.answer(first.result.runId, { needId: 'otro', approved: true }))
    expect(r.result.status).toBe('failed')
    expect(executed).toHaveLength(0)
  })
})

describe('engine · fallback a marcadores (A2)', () => {
  it('si el proveedor no soporta tools, reintenta con <<<DECISION>>> y mantiene el protocolo', async () => {
    const { host, requests, executed } = fakeHost({ script: fixture('engine-markers.json') })
    const engine = createTurnEngine(host)
    const { result, events } = await collect(engine.runTurn({ text: 'mira el proyecto', mode: 'ask', conversationId: 'c1' }))
    expect(result.status).toBe('completed')
    expect(result.summary).toBe('Una pista: Bajo.')
    expect(executed.map((c) => c.name)).toEqual(['track.list'])
    expect(requests[0]!.tools?.length).toBeGreaterThan(0)
    expect(requests[1]!.tools).toBeUndefined()
    expect(requests[1]!.messages[0]!.content).toContain('<<<DECISION')
    // Tras caer a marcadores, el resto del turno ya no envía tools.
    expect(requests[2]!.tools).toBeUndefined()
    expect(requests[2]!.messages.some((m) => m.role === 'tool')).toBe(false)
    expect(result.run.protocol).toBe('markers')
    expect(events.some((e) => e.type === 'provider' && e.protocol === 'markers')).toBe(true)
  })
})

describe('engine · presupuesto', () => {
  it('cuenta cada intento de la cadena de fallback y corta al agotarse', async () => {
    const { host } = fakeHost({
      script: { responses: [], fallback: { toolCalls: [{ name: 'track.list' }] } },
      attemptsPerChat: 3,
      budget: { maxModelCalls: 5 },
    })
    const engine = createTurnEngine(host)
    const { result, events } = await collect(engine.runTurn({ text: 'x', mode: 'ask', conversationId: 'c1' }))
    expect(result.status).toBe('failed')
    const last = events[events.length - 1]!
    expect(last.type === 'turn.failed' && last.reason).toBe('budget')
    expect(result.run.budget.modelCalls).toBe(5)
  })

  it('suma los reintentos internos del gateway (httpAttempts)', async () => {
    let n = 0
    const { host } = fakeHost({
      chatImpl: async (_req, o) => {
        o.beforeAttempt({ index: 0, total: 1, label: 'm' })
        n += 1
        return n === 1
          ? { success: true, content: '', toolCalls: [{ id: 'x', name: 'track.list', arguments: {} }], httpAttempts: 3 }
          : { success: true, content: 'listo' }
      },
    })
    const r = await collect(createTurnEngine(host).runTurn({ text: 'x', mode: 'ask', conversationId: 'c1' }))
    expect(r.result.status).toBe('completed')
    expect(r.result.run.budget.modelCalls).toBe(4)
  })
})

describe('engine · piezas', () => {
  it('ensureSystemRules es idempotente', () => {
    const once = ensureSystemRules('base', { role: 'mezcla', plan: 'plan' })
    expect(ensureSystemRules(once, { role: 'mezcla', plan: 'plan' })).toBe(once)
    expect(once).toContain('Ingeniero de mezcla')
  })

  it('toMarkerMessages convierte tool_calls y resultados a texto', () => {
    const out = toMarkerMessages([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'track.list', arguments: {} }] },
      { role: 'tool', toolCallId: 'a', name: 'track.list', content: '[]' },
    ])
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(out[1]!.content).toContain('<<<DECISION')
    expect(out[2]!.content).toContain('untrusted="true"')
  })

  it('gateToolForMode: ask/think/plan no mutan; plan permite plan.*; destructivas confirman', () => {
    expect(gateToolForMode(modeCapabilities('ask'), 'track.create', 'write', { planApproved: true }).allow).toBe(false)
    expect(gateToolForMode(modeCapabilities('plan'), 'plan.updateStep', 'write', { planApproved: false }).allow).toBe(true)
    expect(gateToolForMode(modeCapabilities('create'), 'track.delete', 'destructive', { planApproved: true })).toEqual({ allow: true, needs: 'confirm' })
    expect(gateToolForMode(modeCapabilities('auto'), 'x.y', undefined, { planApproved: true }).allow).toBe(false)
  })

  it('decisión desde tool calls nativas', () => {
    expect(agentDecisionFromToolCalls([{ name: 'agent.complete', arguments: { summary: 'ok' } }])).toEqual({ type: 'complete', summary: 'ok' })
    const d = agentDecisionFromToolCalls([{ id: 't1', name: 'track.list' }, { name: 'agent.complete' }])
    expect(d?.type).toBe('tool-calls')
    expect(agentDecisionFromChatResponse({ content: 'respuesta en prosa' }, { native: true })).toEqual({ type: 'complete', summary: 'respuesta en prosa' })
    expect(agentDecisionFromChatResponse({ content: 'respuesta en prosa' }, { native: false })).toBeNull()
    expect(agentDecisionFromChatResponse({ content: '<<<DECISION {"type":"fail","reason":"x"} DECISION>>>' }, { native: true })).toEqual({ type: 'fail', reason: 'x' })
  })

  it('parseEngineRun rechaza archivos corruptos', () => {
    expect(parseEngineRun('no json')).toBeNull()
    expect(parseEngineRun({ version: 99 })).toBeNull()
  })
})

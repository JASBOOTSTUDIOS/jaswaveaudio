import { describe, it, expect } from 'vitest'
import {
  createTurnEngine,
  drainTurn,
  createMockPlayer,
  parseMockScript,
  gateToolForMode,
  modeCapabilities,
  visibleInMode,
  isPlanWriteTool,
  type EngineEvent,
  type EngineHost,
  type EngineHostChatRequest,
  type MockScript,
} from '../engine'
import { agentModeLabel, resolveMode, workingMode } from '../agent/modes'

function fakeHost(opts: {
  script: MockScript
  classify?: Record<string, 'read' | 'write' | 'destructive' | 'system'>
  docs?: Map<string, string>
}) {
  let clock = 1_000_000
  const player = createMockPlayer(opts.script)
  const requests: EngineHostChatRequest[] = []
  const executed: string[] = []
  const docs = opts.docs ?? new Map<string, string>()
  const host: EngineHost = {
    now: () => (clock += 5),
    buildSystemPrompt: ({ mode }) => `Eres el coproductor de JasWave. Modo ${mode}.`,
    listTools: () => [
      { name: 'track.list', description: 'Lista pistas', parameters: { type: 'object', properties: {} } },
      { name: 'track.create', description: 'Crea pista', parameters: { type: 'object', properties: {} } },
      { name: 'project.setBpm', description: 'Tempo', parameters: { type: 'object', properties: {} } },
      { name: 'track.delete', description: 'Borra pista', parameters: { type: 'object', properties: {} } },
      { name: 'doc.read', description: 'Lee doc', parameters: { type: 'object', properties: {} } },
      { name: 'doc.write', description: 'Escribe doc', parameters: { type: 'object', properties: {} } },
    ],
    classifyTool: (call) => opts.classify?.[call.name],
    async chat(req, copts) {
      requests.push(req)
      if (!copts.beforeAttempt({ index: 0, total: 1, label: 'm0' })) return { success: false, error: 'budget' }
      const r = player.next({
        messages: req.messages,
        hasTools: Boolean(req.tools?.length),
        purpose: req.meta.purpose,
        role: req.meta.role,
      })
      return { ...r, usedModel: 'mock' }
    },
    async executeTools(calls) {
      for (const c of calls) {
        if (c.name === 'doc.write' && typeof c.arguments.slug === 'string') docs.set(c.arguments.slug, String(c.arguments.content ?? ''))
        executed.push(c.name)
      }
      return calls.map((c) => ({ callId: c.id, name: c.name, status: 'success' as const, data: { ok: true } }))
    },
    readDoc: (slug) => docs.get(slug) ?? null,
    writeDoc: (slug, content) => void docs.set(slug, content),
  }
  return { host, requests, executed, docs }
}

const CLASSES: Record<string, 'read' | 'write' | 'destructive' | 'system'> = {
  'track.list': 'read',
  'doc.read': 'read',
  'track.create': 'write',
  'project.setBpm': 'write',
  'doc.write': 'write',
  'track.delete': 'destructive',
}

function script(raw: unknown): MockScript {
  return parseMockScript(raw)
}

async function collect(handle: ReturnType<ReturnType<typeof createTurnEngine>['runTurn']>) {
  const events: EngineEvent[] = []
  const result = await drainTurn(handle, (e) => events.push(e))
  return { events, result }
}

function needsOf(events: EngineEvent[]) {
  return events.flatMap((e) => (e.type === 'needs-user' ? [e.need] : []))
}

describe('A3 · resolveMode: el selector del usuario manda', () => {
  it('nunca cambia el modo elegido; sugiere solo si difiere', () => {
    expect(resolveMode('plan', 'crea una pista de pad')).toEqual({ mode: 'plan', suggestion: 'create' })
    expect(resolveMode('ask', '¿qué pistas hay?')).toEqual({ mode: 'ask' })
    expect(resolveMode('create', 'analiza el proyecto')).toEqual({ mode: 'create', suggestion: 'ask' })
    expect(resolveMode('think', 'piensa el arreglo')).toEqual({ mode: 'think' })
  })

  it('auto nunca sugiere (resuelve él mismo)', () => {
    expect(resolveMode('auto', 'crea una pista')).toEqual({ mode: 'auto' })
  })

  it('workingMode: auto lo decide el texto; el resto lo decide el usuario (sin override)', () => {
    expect(workingMode('auto', 'crea una canción ambient')).toBe('create')
    expect(workingMode('auto', '¿qué hay en el proyecto?')).toBe('ask')
    // detectAgentMode forzaría create para edición MIDI incluso en plan; aquí manda el selector.
    expect(workingMode('plan', 'suaviza el groove de la intro')).toBe('plan')
    expect(workingMode('ask', 'crea un pad')).toBe('ask')
    expect(workingMode('think', 'analiza el proyecto')).toBe('think')
  })

  it('agentModeLabel etiqueta los modos', () => {
    expect(agentModeLabel('auto')).toBe('Auto')
    expect(agentModeLabel('create')).toBe('Crear')
  })
})

describe('A3 · ask: no muta aunque el modelo lo intente', () => {
  it('rechaza la escritura con error al modelo y termina con respuesta', async () => {
    const { host, executed, requests } = fakeHost({
      classify: CLASSES,
      script: script({
        responses: [
          { when: { purpose: 'agent' }, toolCalls: [{ name: 'track.create', arguments: { nombre: 'Pad' } }] },
          { when: { purpose: 'agent', afterToolResult: true }, content: 'Tienes 2 pistas; ninguna necesita cambios.' },
        ],
      }),
    })
    const { events, result } = await collect(createTurnEngine(host).runTurn({ text: '¿qué pistas hay?', mode: 'ask', conversationId: 'c1' }))
    expect(result.status).toBe('completed')
    expect(executed).toEqual([])
    const rejected = events.filter((e) => e.type === 'tool.result' && e.result.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.type === 'tool.result' && rejected[0]!.result.error?.message).toContain('«ask»')
    // Ni siquiera llega a pedir confirmación: la guarda de modo manda.
    expect(needsOf(events)).toHaveLength(0)
    // Tools visibles en ask: solo lecturas + control.
    const toolNames = requests[0]!.tools!.map((t) => t.name)
    expect(toolNames).toContain('track.list')
    expect(toolNames).not.toContain('track.create')
    expect(toolNames).not.toContain('track.delete')
    expect(toolNames).toContain('agent.complete')
  })
})

describe('A3 · plan: solo escribe el plan', () => {
  it('permite doc.write sobre plan.md y rechaza otros docs y mutaciones', async () => {
    const { host, executed, docs } = fakeHost({
      classify: CLASSES,
      script: script({
        responses: [
          {
            when: { purpose: 'agent' },
            toolCalls: [{ name: 'doc.write', arguments: { slug: 'plan.md', content: '# Plan · pad\n\n## Pasos\n- [ ] S1 · estructura — Crear pad\n' } }],
          },
          {
            when: { purpose: 'agent', afterToolResult: true },
            toolCalls: [{ name: 'doc.write', arguments: { slug: 'sesion-notas.md', content: 'notas' } }],
          },
          {
            when: { purpose: 'agent', afterToolResult: true },
            toolCalls: [{ name: 'track.create', arguments: { nombre: 'Pad' } }],
          },
          { when: { purpose: 'agent', afterToolResult: true }, content: 'Plan listo en plan.md para que lo revises.' },
        ],
      }),
    })
    const { events, result } = await collect(createTurnEngine(host).runTurn({ text: 'haz un plan del tema', mode: 'plan', conversationId: 'c1' }))
    expect(result.status).toBe('completed')
    expect(executed).toEqual(['doc.write'])
    expect(docs.get('plan.md')).toContain('## Pasos')
    const rejected = events.filter((e) => e.type === 'tool.result' && e.result.status === 'rejected')
    expect(rejected).toHaveLength(2)
    expect(needsOf(events)).toHaveLength(0)
  })
})

describe('A3 · create: pide aprobación del plan una sola vez', () => {
  it('la primera escritura pide aprobación; las siguientes ya no', async () => {
    const { host, executed } = fakeHost({
      classify: CLASSES,
      script: script({
        responses: [
          { when: { purpose: 'agent' }, toolCalls: [{ name: 'track.create', arguments: { nombre: 'Pad' } }] },
          { when: { purpose: 'agent', afterToolResult: true }, toolCalls: [{ name: 'project.setBpm', arguments: { bpm: 96 } }] },
          { when: { purpose: 'agent', afterToolResult: true }, content: 'Pad creado y tempo a 96 BPM.' },
        ],
      }),
    })
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'añade un pad', mode: 'create', conversationId: 'c1' }))
    expect(first.result.status).toBe('waiting-user')
    expect(first.result.run.pending?.kind).toBe('approve-plan')
    expect(executed).toHaveLength(0)

    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(second.result.status).toBe('completed')
    expect(executed).toEqual(['track.create', 'project.setBpm'])
    // Solo UNA aprobación en todo el turno (ni create ni su script vuelven a pedirla).
    const allNeeds = [...needsOf(first.events), ...needsOf(second.events)]
    expect(allNeeds.filter((n) => n.kind === 'approve-plan')).toHaveLength(1)
    expect(allNeeds.filter((n) => n.kind === 'confirm')).toHaveLength(0)
  })
})

describe('A3 · auto: no pide aprobación del plan', () => {
  it('ejecuta escrituras directas y solo confirma destructivas', async () => {
    const { host, executed } = fakeHost({
      classify: CLASSES,
      script: script({
        responses: [
          { when: { purpose: 'agent' }, toolCalls: [{ name: 'track.create', arguments: { nombre: 'Pad' } }] },
          { when: { purpose: 'agent', afterToolResult: true }, toolCalls: [{ name: 'track.delete', arguments: { trackId: 'vacia_01' } }] },
          { when: { purpose: 'agent', afterToolResult: true }, content: 'Hecho.' },
        ],
      }),
    })
    const engine = createTurnEngine(host)
    const first = await collect(engine.runTurn({ text: 'añade un pad', mode: 'auto', conversationId: 'c1' }))
    expect(first.result.run.pending?.kind).toBe('confirm')
    expect(executed).toEqual(['track.create'])
    expect(needsOf(first.events).filter((n) => n.kind === 'approve-plan')).toHaveLength(0)

    const second = await collect(engine.answer(first.result.runId, { approved: true }))
    expect(second.result.status).toBe('completed')
    expect(executed).toEqual(['track.create', 'track.delete'])
  })

  it('destructivas confirman también en create con plan aprobado', async () => {
    const { host, executed } = fakeHost({
      classify: CLASSES,
      script: script({
        responses: [
          { when: { purpose: 'agent' }, toolCalls: [{ name: 'track.delete', arguments: { trackId: 'vacia_01' } }] },
          { when: { purpose: 'agent', afterToolResult: true }, content: 'Borrada.' },
        ],
      }),
    })
    const { events, result } = await collect(
      createTurnEngine(host).runTurn({ text: 'borra la pista vacía', mode: 'create', conversationId: 'c1', planApproved: true }),
    )
    expect(result.status).toBe('waiting-user')
    expect(result.run.pending?.kind).toBe('confirm')
    expect(executed).toHaveLength(0)
    expect(needsOf(events).filter((n) => n.kind === 'confirm')).toHaveLength(1)
  })
})

describe('A3 · piezas de capacidades', () => {
  const caps = (m: 'ask' | 'think' | 'plan' | 'create' | 'auto') => modeCapabilities(m)

  it('isPlanWriteTool detecta plan.* y doc sobre plan.md', () => {
    expect(isPlanWriteTool('plan.updateStep', {})).toBe(true)
    expect(isPlanWriteTool('doc.write', { slug: 'plan.md' })).toBe(true)
    expect(isPlanWriteTool('doc.append', { slug: 'docs/proyecto/plan.md' })).toBe(true)
    expect(isPlanWriteTool('doc.write', { slug: 'sesion.md' })).toBe(false)
    expect(isPlanWriteTool('doc.write', {})).toBe(false)
  })

  it('visibleInMode filtra la lista de tools por modo', () => {
    expect(visibleInMode(caps('ask'), 'track.list', 'read')).toBe(true)
    expect(visibleInMode(caps('ask'), 'doc.write', 'write')).toBe(false)
    expect(visibleInMode(caps('plan'), 'doc.write', 'write')).toBe(true)
    expect(visibleInMode(caps('plan'), 'track.create', 'write')).toBe(false)
    expect(visibleInMode(caps('create'), 'track.create', 'write')).toBe(true)
    expect(visibleInMode(caps('auto'), 'track.delete', 'destructive')).toBe(true)
    expect(visibleInMode(caps('ask'), 'x.y', undefined)).toBe(false)
  })

  it('gateToolForMode: plan escribe solo plan.md; think nunca escribe', () => {
    expect(gateToolForMode(caps('plan'), 'doc.write', 'write', { planApproved: false, args: { slug: 'plan.md' } }).allow).toBe(true)
    expect(gateToolForMode(caps('plan'), 'doc.write', 'write', { planApproved: false, args: { slug: 'otro.md' } }).allow).toBe(false)
    expect(gateToolForMode(caps('think'), 'doc.write', 'write', { planApproved: false, args: { slug: 'plan.md' } }).allow).toBe(false)
    expect(gateToolForMode(caps('create'), 'track.create', 'write', { planApproved: false })).toEqual({ allow: true, needs: 'approve-plan' })
  })
})

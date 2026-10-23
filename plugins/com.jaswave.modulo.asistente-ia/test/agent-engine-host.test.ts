/**
 * npx tsx --test src/lib/agent-engine-host.test.ts
 *
 * Turnos completos del coproductor a través del motor (A1) con el proveedor mock (A2):
 * window.electron simulado (aiChat = guion, agentRunSave/Load en memoria).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { createMockPlayer, parseMockScript, type MockScript } from '@/electron/ai-mock'

type AnyRec = Record<string, unknown>

const requests: Array<{ messages: Array<{ role: string; content: string }>; tools?: unknown[]; meta?: AnyRec }> = []
const runsOnDisk = new Map<string, string>()
let player = createMockPlayer({ responses: [] })

function useScript(s: MockScript) {
  player = createMockPlayer(parseMockScript(s))
  requests.length = 0
}

before(() => {
  const store = new Map<string, string>()
  const g = globalThis as unknown as AnyRec
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
  g.window = {
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    localStorage: g.localStorage,
    electron: {
      aiChat: async (req: { messages: Array<{ role: string; content: string }>; tools?: unknown[]; meta?: AnyRec }) => {
        requests.push(req)
        const r = player.next({
          messages: req.messages,
          hasTools: Boolean(req.tools?.length),
          purpose: req.meta?.purpose as string | undefined,
          role: req.meta?.role as string | undefined,
        })
        return { ...r, model: 'mock', provider: 'mock', httpAttempts: 1 }
      },
      aiChatCancel: async () => true,
      agentRunSave: async (id: string, json: string) => {
        runsOnDisk.set(id, json)
        return { ok: true }
      },
      agentRunLoad: async (id: string) => runsOnDisk.get(id) ?? null,
      agentRunList: async () => [],
      agentRunDelete: async (id: string) => runsOnDisk.delete(id),
    },
  }
  if (typeof g.CustomEvent === 'undefined') {
    g.CustomEvent = class extends Event {
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        super(type)
        this.detail = init?.detail
      }
    }
  }
})

async function setup() {
  const shared = await import('../../../shared/src/index')
  const { registerAgentCatalogOnRegistry } = await import('@/src/lib/agent-action-catalog')
  const tienda = shared.crearTiendaDAW({ estadoInicial: shared.crearEstadoInicial() })
  shared.toolRegistry.setContext(tienda.executor, tienda.permisos)
  registerAgentCatalogOnRegistry(shared.toolRegistry, undefined, tienda.registroComandos)
  // M2: los modelos vienen del catálogo del backend; aquí, un modelo propio local (lo ejecuta "Electron").
  const { fijarCatalogoIA } = await import('../src/ia/catalogo-ia')
  fijarCatalogoIA({
    permisos: { usar: true, modeloPropio: true, proveedores: [] },
    proveedores: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        slug: 'u-mock',
        nombre: 'Mock',
        tipo: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        modelos: ['mock'],
        modeloPorDefecto: 'mock',
        maxTokens: 4096,
        herramientas: true,
        origen: 'propio',
        ejecucion: 'local',
        activo: true,
        tieneClave: false,
      },
    ],
  })
  const host = await import('../src/motor/agent-engine-host')
  const chat = await import('../src/motor/ai-chat-store')
  chat.setChatProjectScope('p1')
  const conv = chat.createConversation('test', 'p1')
  return { tienda, host, chat, conv }
}

describe('motor + programa coproductor (mock)', () => {
  it('turno ask: todos los chats llevan system prompt y el mensaje final queda en el chat', async () => {
    useScript({
      responses: [{ when: { purpose: 'final' }, content: 'Para el coro: sube la energía con un pad y dobla la voz.' }],
      fallback: { content: 'Pienso en el arreglo del coro.' },
    })
    const { tienda, host, chat, conv } = await setup()
    const { handle, assistantMsgId } = host.startCoproducerTurn(tienda, {
      conversationId: conv.id,
      projectId: 'p1',
      text: 'dame ideas para el coro de esta canción',
      mode: 'ask',
    })
    const events: string[] = []
    for await (const e of handle) events.push(e.type)
    const res = await handle.result
    assert.equal(res.status, 'completed', res.summary)
    assert.ok(events.includes('turn.started') && events.includes('turn.done'))
    assert.ok(requests.length >= 1)
    for (const r of requests) {
      assert.equal(r.messages[0]?.role, 'system', `chat ${String(r.meta?.purpose)} sin system`)
      assert.match(r.messages[0]!.content, /Datos no confiables/)
    }
    const msg = chat.getConversation(conv.id)!.messages.find((m) => m.id === assistantMsgId)!
    assert.match(msg.content, /coro/)
    assert.equal(msg.engineRunId, handle.runId)
    // Persistido en el almacén de runs (userData/agent-runs vía IPC).
    const saved = JSON.parse(runsOnDisk.get(handle.runId)!)
    assert.equal(saved.status, 'completed')
    assert.ok(saved.budget.modelCalls >= requests.length)
  })

  it('turno create: tool call nativa → tarjeta Aplicar (needs-user) → Aplicar vía motor ejecuta', async () => {
    useScript({
      responses: [
        {
          when: { purpose: 'agent', hasTools: true, afterToolResult: false },
          content: 'Ajusto el tempo.',
          toolCalls: [{ name: 'project.setBpm', arguments: { bpm: 97 } }],
        },
        {
          when: { purpose: 'agent' },
          content: '<<<DECISION {"type":"complete","summary":"Tempo en 97 BPM."} DECISION>>>',
          repeat: true,
        },
      ],
      fallback: { content: 'Entendido: bajar el tempo.' },
    })
    const { tienda, host, chat, conv } = await setup()
    const { handle, assistantMsgId } = host.startCoproducerTurn(tienda, {
      conversationId: conv.id,
      projectId: 'p1',
      text: 'pon el tempo a 97 bpm',
      mode: 'create',
    })
    for await (const _e of handle) void _e
    const res = await handle.result
    assert.equal(res.status, 'waiting-user', res.summary)
    assert.equal(res.run.pending?.kind, 'apply')
    const agentReq = requests.find((r) => r.meta?.purpose === 'agent')
    assert.ok(agentReq?.tools?.length, 'el agent loop envía tools nativas')
    const msg = chat.getConversation(conv.id)!.messages.find((m) => m.id === assistantMsgId)!
    assert.equal(msg.pendingActions?.status, 'pending')
    assert.equal(msg.pendingActions?.actions[0]?.type, 'project.setBpm')
    assert.notEqual(tienda.obtenerEstado().project.bpm.valor, 97)

    // Aplicar (tarjeta) → engine.answer sobre el run persistido.
    const apply = await host.answerPendingActions(tienda, {
      conversationId: conv.id,
      messageId: assistantMsgId,
      agentMode: 'create',
      actions: msg.pendingActions!.actions,
      indices: [0],
      userTextHint: 'pon el tempo a 97 bpm',
    })
    assert.equal(apply.runId, handle.runId, 'responde al mismo run')
    for await (const _e of apply) void _e
    const done = await apply.result
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 97)
    const out = done.outcome as { ok: boolean }
    assert.equal(out.ok, true)
    // El chat del loop reanudado tras Aplicar lleva system prompt (antes iba sin él).
    const afterApply = requests.filter((r) => r.meta?.purpose === 'agent').slice(1)
    for (const r of afterApply) assert.equal(r.messages[0]?.role, 'system')
  })
})

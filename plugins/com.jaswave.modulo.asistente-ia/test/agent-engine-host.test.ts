/**
 * npx tsx --test src/lib/agent-engine-host.test.ts
 *
 * Turnos completos del coproductor a través del motor (A1) con el proveedor mock (A2):
 * window.electron simulado (aiChat = guion, agentRunSave/Load en memoria).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import { createRequire } from 'node:module'
import { createMockPlayer, parseMockScript, type MockScript } from '@/electron/ai-mock'

type AnyRec = Record<string, unknown>

/** El mismo gestor de permisos que usa la app (tsx carga jas-wave como CJS: otra instancia que la de un import ESM). */
function permisosApp(): { setUserConfig: (c: AnyRec, s: string) => void } {
  const req = createRequire(new URL('../../../jas-wave/src/lib/ai-action-policy.ts', import.meta.url))
  return req('../../../shared/src/state/permissions').permissionManager
}

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

  const guionTempo = (): MockScript => ({
    responses: [
      {
        when: { purpose: 'agent', hasTools: true, afterToolResult: false },
        content: 'Ajusto el tempo.',
        toolCalls: [{ name: 'project.setBpm', arguments: { bpm: 97 } }],
      },
      { when: { purpose: 'agent' }, content: 'Listo: el tempo quedó en 97 BPM.', repeat: true },
    ],
    fallback: { content: 'Entendido: bajar el tempo.' },
  })

  it('turno create: el agente ejecuta la herramienta e informa los pasos sin detalles técnicos', async () => {
    permisosApp().setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user')
    useScript(guionTempo())
    const { tienda, host, chat, conv } = await setup()
    const { handle, assistantMsgId } = host.startCoproducerTurn(tienda, {
      conversationId: conv.id,
      projectId: 'p1',
      text: 'pon el tempo a 97 bpm',
      mode: 'create',
    })
    for await (const _e of handle) void _e
    const res = await handle.result
    assert.equal(res.status, 'completed', res.summary)
    const agentReq = requests.find((r) => r.meta?.purpose === 'agent')
    assert.ok(agentReq?.tools?.length, 'el agente envía tools nativas')
    assert.equal(tienda.obtenerEstado().project.bpm.valor, 97)
    const msg = chat.getConversation(conv.id)!.messages.find((m) => m.id === assistantMsgId)!
    assert.match(msg.content, /97/)
    assert.equal(msg.agente?.estado, 'listo')
    assert.ok(msg.agente?.actividad.some((a) => a.estado === 'ok'), 'el paso queda registrado para la UI')
    assert.doesNotMatch(msg.content, /project.setBpm|<<<|{"/, 'sin nombres internos ni JSON')
  })

  it('/plan sin texto: el agente recibe un pedido útil sin la barra y no modifica el proyecto', async () => {
    useScript(guionTempo())
    const { tienda, host, conv } = await setup()
    const bpmAntes = tienda.obtenerEstado().project.bpm.valor
    const { handle } = host.startCoproducerTurn(tienda, {
      conversationId: conv.id,
      projectId: 'p1',
      text: '/plan',
      mode: 'create',
      comando: { tipo: 'plan', texto: '' },
    })
    for await (const _e of handle) void _e
    const res = await handle.result
    assert.equal(res.status, 'completed', res.summary)
    const agentReq = requests.find((r) => r.meta?.purpose === 'agent')!
    const ultimoUsuario = [...agentReq.messages].reverse().find((m) => m.role === 'user')!
    assert.doesNotMatch(ultimoUsuario.content, /^\/plan/)
    assert.match(ultimoUsuario.content, /plan de trabajo/)
    assert.equal(tienda.obtenerEstado().project.bpm.valor, bpmAntes, 'el modo plan es de solo lectura')
  })

  it('banda: el equipo de agentes recorre las etapas, el QA mide y el panel en vivo lo refleja', async () => {
    useScript({ responses: [], fallback: { content: 'Hecho.' } })
    const { tienda, host, chat, conv } = await setup()
    const { orquestadorBandaSingleton } = await import('../src/motor/banda-orchestrator')
    const { handle, assistantMsgId } = host.startCoproducerTurn(tienda, {
      conversationId: conv.id,
      projectId: 'p1',
      text: '/banda una balada en Re',
      mode: 'create',
      kind: 'banda',
    })
    for await (const _e of handle) void _e
    const res = await handle.result
    const agentes = requests.filter((r) => r.meta?.purpose === 'agent').map((r) => /^Eres ([^\n]+?) en la producción/.exec(r.messages[0]!.content)?.[1])
    assert.ok(agentes.includes('Planificador') || agentes.some((a) => /plan/i.test(a ?? '')), `sin planificador: ${agentes.join(', ')}`)
    // Sin partes grabadas, la medición no aprueba y hay rondas de corrección (con tope)...
    const vivo = orquestadorBandaSingleton.getState()
    assert.equal(vivo.activo, false)
    assert.ok(vivo.eventos.some((e) => e.fase === 'qa_musicos' && e.estadoQA === 'corrigiendo'))
    assert.equal(vivo.qaReporte.rondas, 2)
    // ...y como nadie grabó nada, no sigue con mezcla ni máster y lo explica (sin el aviso genérico de error).
    assert.equal(res.status, 'failed')
    assert.ok(!agentes.some((a) => /mezcla|master|máster/i.test(a ?? '')), `siguió con la mezcla: ${agentes.join(', ')}`)
    const msg = chat.getConversation(conv.id)!.messages.find((m) => m.id === assistantMsgId)!
    assert.equal(msg.agente?.estado, 'error')
    assert.ok(msg.agente!.tareas.length >= 4)
    assert.match(msg.content, /no consiguieron grabar ninguna parte/)
    assert.doesNotMatch(msg.content, /veredicto_calidad|asignar_encargos|\{"/)
  })

  it('autonomía «sugerir»: queda la tarjeta Aplicar y Aplicar ejecuta', async () => {
    permisosApp().setUserConfig({ level: 'SUGGEST', overrides: [], allowUnsafeTools: false }, 'user')
    try {
      useScript(guionTempo())
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
      const msg = chat.getConversation(conv.id)!.messages.find((m) => m.id === assistantMsgId)!
      assert.equal(msg.pendingActions?.status, 'pending')
      assert.equal(msg.pendingActions?.actions[0]?.type, 'project.setBpm')
      assert.notEqual(tienda.obtenerEstado().project.bpm.valor, 97)

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
      assert.equal((done.outcome as { ok: boolean }).ok, true)
    } finally {
      permisosApp().setUserConfig({ level: 'CONFIRM', overrides: [], allowUnsafeTools: false }, 'user')
    }
  })
})

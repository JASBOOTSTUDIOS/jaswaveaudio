/**
 * npx tsx --test src/lib/ia/transporte-ia.test.ts
 * M1: el asistente en la web usa el gateway /ia del backend con el JWT de la sesión.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearTransporteBackend } from '../src/ia/transporte-ia'

type Llamada = { url: string; init: RequestInit }

function fetchFalso(responder: (url: string, cuerpo: Record<string, unknown>) => Response) {
  const llamadas: Llamada[] = []
  const f = (async (url: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} })
    return responder(String(url), init?.body ? JSON.parse(String(init.body)) : {})
  }) as typeof fetch
  return { f, llamadas }
}

const json = (datos: unknown, status = 200) => new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json' } })

function sse(eventos: unknown[], trozo = 7): Response {
  const texto = eventos.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
  const bytes = new TextEncoder().encode(texto)
  // Trozos pequeños para probar el reensamblado de eventos partidos entre lecturas.
  const cuerpo = new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < bytes.length; i += trozo) c.enqueue(bytes.subarray(i, i + trozo))
      c.close()
    },
  })
  return new Response(cuerpo, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

describe('M1 — transporte de IA hacia el backend', () => {
  it('chat: envía el JWT, el proveedor y el modelo elegidos, y nunca host ni clave', async () => {
    const { f, llamadas } = fetchFalso(() => json({ success: true, content: 'hola' }))
    const t = crearTransporteBackend({ base: 'https://api.test', token: async () => 'jwt-1', fetch: f })
    const r = await t.chat({
      kind: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-local',
      model: 'gpt-4o',
      providerId: '6f1c2b8e-1d2a-4c3b-9a8e-112233445566',
      messages: [{ role: 'user', content: 'hola' }],
      tools: [{ name: 'transport.setBpm', description: 'BPM', parameters: { type: 'object' } }],
      requestId: 'chat-abc',
    } as never)
    assert.equal(r.content, 'hola')
    assert.equal(llamadas[0]!.url, 'https://api.test/ia/chat')
    assert.equal((llamadas[0]!.init.headers as Record<string, string>).Authorization, 'Bearer jwt-1')
    const cuerpo = JSON.parse(String(llamadas[0]!.init.body))
    assert.deepEqual(Object.keys(cuerpo).sort(), ['messages', 'model', 'proveedorId', 'requestId', 'tools'])
    assert.equal(cuerpo.proveedorId, '6f1c2b8e-1d2a-4c3b-9a8e-112233445566')
    assert.ok(!JSON.stringify(cuerpo).includes('sk-local'))
  })

  it('sin sesión no llama al servidor y pide iniciar sesión', async () => {
    const { f, llamadas } = fetchFalso(() => json({}))
    const t = crearTransporteBackend({ base: 'https://api.test', token: async () => null, fetch: f })
    const r = await t.chat({ messages: [{ role: 'user', content: 'x' }] } as never)
    assert.equal(r.success, false)
    assert.equal(r.errorCode, 'unauthorized')
    assert.equal(llamadas.length, 0)
  })

  it('errores HTTP del backend se traducen a códigos del asistente', async () => {
    for (const [status, codigo] of [[429, 'rate_limit'], [503, 'not_available'], [400, 'bad_request']] as const) {
      const { f } = fetchFalso(() => json({ error: { codigo: 'x', mensaje: `fallo ${status}` } }, status))
      const r = await crearTransporteBackend({ base: 'b', token: async () => 't', fetch: f }).chat({ messages: [] } as never)
      assert.equal(r.errorCode, codigo)
      assert.equal(r.error, `fallo ${status}`)
    }
  })

  it('stream SSE: entrega los deltas en orden aunque lleguen partidos y devuelve el resultado final', async () => {
    const { f, llamadas } = fetchFalso(() =>
      sse([
        { type: 'delta', text: 'Hola' },
        { type: 'delta', text: ' desde' },
        { type: 'delta', text: ' la web' },
        { type: 'done', result: { success: true, content: 'Hola desde la web' } },
      ]),
    )
    const t = crearTransporteBackend({ base: 'b', token: async () => 't', fetch: f })
    const deltas: string[] = []
    const r = await t.chatStream!({ messages: [{ role: 'user', content: 'x' }] } as never, (e) => {
      if (e.type === 'delta') deltas.push(e.text!)
    })
    assert.equal(llamadas[0]!.url, 'b/ia/chat/stream')
    assert.equal(deltas.join(''), 'Hola desde la web')
    assert.equal(r.success, true)
    assert.equal(r.content, 'Hola desde la web')
  })

  it('stream cortado sin evento final → error de conexión', async () => {
    const { f } = fetchFalso(() => sse([{ type: 'delta', text: 'a' }]))
    const r = await crearTransporteBackend({ base: 'b', token: async () => 't', fetch: f }).chatStream!({ messages: [] } as never, () => {})
    assert.equal(r.success, false)
    assert.equal(r.errorCode, 'connection')
  })

  it('salud: /ia/estado → healthy con modelos, misconfigured si el servidor no tiene IA', async () => {
    const ok = fetchFalso(() => json({ disponible: true, proveedor: 'openai-compatible', modelo: 'm', modelos: ['m'] }))
    const s1 = await crearTransporteBackend({ base: 'b', token: async () => 't', fetch: ok.f }).salud()
    assert.deepEqual(s1, { status: 'healthy', models: ['m'], provider: 'openai-compatible' })
    const sin = fetchFalso(() => json({ disponible: false, motivo: 'ia_no_configurada' }))
    const s2 = await crearTransporteBackend({ base: 'b', token: async () => 't', fetch: sin.f }).salud()
    assert.equal(s2.status, 'misconfigured')
  })

  it('cancelar usa el id del cliente (el backend lo aísla por usuario)', async () => {
    const { f, llamadas } = fetchFalso(() => json({ cancelada: true }))
    assert.equal(await crearTransporteBackend({ base: 'b', token: async () => 't', fetch: f }).cancelar('chat-1'), true)
    assert.deepEqual(JSON.parse(String(llamadas[0]!.init.body)), { requestId: 'chat-1' })
  })
})

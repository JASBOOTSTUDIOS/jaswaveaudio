import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnContext } from '@jaswave/host-sdk'
import { BandaOrchestrator } from '../src/motor/banda-orchestrator'
import { chatDelMotor, type RedChat } from '../src/motor/turno/chat-agente'
import { masterMinimoDeterminista } from '../src/motor/turno/master-minimo'
import { medirBanda } from '../src/motor/turno/turno-banda'
import { crearEstadoInicial, crearTiendaDAW, registrarSondaPlugins } from '../../../shared/src/index'
import type { AiSettings } from '../src/motor/ai-settings'

const cfg = { temperature: 0.3, maxTokens: 2048 } as AiSettings
const pedido = { sistema: 's', mensajes: [], herramientas: [], profundidad: 1 } as unknown as Parameters<ReturnType<typeof chatDelMotor>>[0]

function contexto(respuestas: Array<Record<string, unknown>>, signal = new AbortController().signal) {
  let n = 0
  const ctx = { signal, chat: async () => respuestas[Math.min(n++, respuestas.length - 1)] } as unknown as TurnContext
  return { ctx, llamadas: () => n }
}
const sinRed = { success: false, errorCode: 'connection', error: 'No se pudo contactar con el servidor de JasWave.' }

describe('pausa por falta de red en el chat de la banda', () => {
  it('la caída de internet no gasta reintentos: espera, continúa sola y devuelve la respuesta', async () => {
    let enLinea = false
    const eventos: string[] = []
    const red: RedChat = {
      enLinea: () => enLinea,
      sondear: async () => true,
      dormir: async () => {
        eventos.push('espera')
        if (eventos.filter((e) => e === 'espera').length === 3) enLinea = true
      },
      alPausar: () => eventos.push('pausa'),
      alReanudar: () => eventos.push('reanuda'),
    }
    // Más caídas que reintentos permitidos (esperas = []): sin la pausa la producción se habría estropeado.
    const { ctx, llamadas } = contexto([sinRed, sinRed, { success: true, content: 'listo', toolCalls: [] }])
    const ult = {}
    const r = await chatDelMotor(ctx, cfg, ult, { delta: 'nunca', esperas: [], red })(pedido)
    assert.equal(r.ok, true)
    assert.equal(r.texto, 'listo')
    assert.deepEqual(eventos, ['pausa', 'espera', 'espera', 'espera', 'reanuda', 'pausa', 'reanuda'])
    assert.equal(llamadas(), 3)
  })

  it('el usuario puede detener la espera sin conexión', async () => {
    const control = new AbortController()
    const red: RedChat = { enLinea: () => false, sondear: async () => false, dormir: async () => control.abort() }
    const { ctx } = contexto([sinRed], control.signal)
    const r = await chatDelMotor(ctx, cfg, {}, { delta: 'nunca', esperas: [], red })(pedido)
    assert.equal(r.ok, false)
  })

  it('las llamadas de herramienta ya entregadas no se repiten tras la pausa', async () => {
    let enLinea = true
    const red: RedChat = {
      enLinea: () => enLinea,
      sondear: async () => true,
      dormir: async () => {
        enLinea = true
      },
    }
    const c1 = { id: 'c1', name: 'midi.clip.create', arguments: { pista: 'bat' } }
    const c2 = { id: 'c2', name: 'midi.clip.create', arguments: { pista: 'baj' } }
    const { ctx } = contexto([{ success: true, content: '', toolCalls: [c1] }, sinRed, { success: true, content: '', toolCalls: [c1, c2] }])
    const chat = chatDelMotor(ctx, cfg, {}, { delta: 'nunca', esperas: [], red })
    const a = await chat(pedido)
    assert.deepEqual(a.llamadas.map((l) => l.id), ['c1'])
    const b = await chat(pedido)
    // Tras la caída y la pausa, c1 (ya entregada) se descarta y solo llega c2.
    assert.deepEqual(b.llamadas.map((l) => l.id), ['c2'])
  })

  it('sin la opción de red se conserva el comportamiento anterior (reintentos limitados)', async () => {
    const { ctx, llamadas } = contexto([sinRed])
    const r = await chatDelMotor(ctx, cfg, {}, { delta: 'nunca', esperas: [1, 1] })(pedido)
    assert.equal(r.ok, false)
    assert.equal(llamadas(), 3)
  })
})

describe('máster mínimo determinista', () => {
  it('normaliza a −14 LUFS y después limita a −1 dBTP, sin modelo, y lo cuenta', async () => {
    const orden: string[] = []
    const r = await masterMinimoDeterminista(
      async (nombre, args) => (orden.push(`${nombre}:${JSON.stringify(args)}`), { ok: true }),
      async () => ({ ok: true, detalles: ['Volumen final −14,1 LUFS', 'Pico −1,0 dBTP'] }),
    )
    assert.equal(r.ok, true)
    assert.match(orden[0]!, /^master\.normalizar:.*"objetivoLufs":-14/)
    assert.match(orden[1]!, /^mix\.limit:.*"trackId":"master".*"ceiling":-1/)
    assert.match(r.resumen, /limitador a -1 dBTP[\s\S]*−14,1 LUFS/)
  })

  it('si un paso falla lo dice y no deja de intentar el otro', async () => {
    const r = await masterMinimoDeterminista(async (n) => (n === 'master.normalizar' ? { ok: false, mensaje: 'sin medición' } : { ok: true }))
    assert.equal(r.ok, false)
    assert.match(r.resumen, /no se pudo: sin medición/)
    assert.match(r.resumen, /limitador a -1 dBTP/)
  })
})

describe('panel de la banda: pausa por red', () => {
  it('marca la pausa, la quita al volver y al terminar', () => {
    const o = new BandaOrchestrator(null)
    o.comenzar('canción', [], () => undefined)
    o.pausarPorRed()
    assert.equal(o.getState().pausaRed, true)
    assert.match(o.getState().eventos.at(-1)!.mensaje, /continuará sola/)
    o.pausarPorRed()
    assert.equal(o.getState().eventos.filter((e) => /continuará sola/.test(e.mensaje)).length, 1)
    o.reanudarDeRed()
    assert.equal(o.getState().pausaRed, false)
    o.pausarPorRed()
    o.terminar({ estado: 'cancelado', plan: '', etapas: [], encargos: [], llamadas: [], texto: '' })
    assert.equal(o.getState().pausaRed, false)
  })
})

describe('caída del host de audio durante una medición', () => {
  const medida = { master: { integrated: -14, truePeakDb: -1.2 }, pistas: [] } as never
  async function conMusica() {
    registrarSondaPlugins(() => ({ plugin: { id: 'p', nombre: 'Piano VST' } as never, listo: true }))
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks[0]!.id
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 4, notas: [{ pitch: 60, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user')
    return tienda
  }

  it('reintenta una vez y devuelve la medición', async () => {
    try {
      const tienda = await conMusica()
      let n = 0
      const m = await medirBanda(tienda, async () => { if (++n === 1) throw new Error('el host de audio se reinició'); return medida }, { reintentoHostMs: 1 })('master')
      assert.equal(n, 2)
      assert.equal(m?.ok, true)
    } finally {
      registrarSondaPlugins(null)
    }
  })

  it('si vuelve a caer, no es medible (null) y la producción sigue', async () => {
    try {
      const tienda = await conMusica()
      let n = 0
      const m = await medirBanda(tienda, async () => { n++; throw new Error('caído') }, { reintentoHostMs: 1 })('master')
      assert.equal(n, 2)
      assert.equal(m, null)
    } finally {
      registrarSondaPlugins(null)
    }
  })
})

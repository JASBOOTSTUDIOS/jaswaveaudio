import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnContext } from '@jaswave/host-sdk'
import { chatDelMotor, esFalloPasajero, type UltimoErrorIA } from '../src/motor/turno/chat-agente'
import type { AiSettings } from '../src/motor/ai-settings'

const cfg = { temperature: 0.3, maxTokens: 2048 } as AiSettings
const pedido = { sistema: 's', mensajes: [], herramientas: [], profundidad: 1 } as unknown as Parameters<ReturnType<typeof chatDelMotor>>[0]

function contexto(respuestas: Array<Record<string, unknown>>) {
  let n = 0
  const ctx = { signal: new AbortController().signal, chat: async () => respuestas[Math.min(n++, respuestas.length - 1)] } as unknown as TurnContext
  return { ctx, llamadas: () => n }
}

describe('chatDelMotor: fallos pasajeros del servicio', () => {
  it('«muy ocupada» se reintenta y sigue con la respuesta buena', async () => {
    const { ctx, llamadas } = contexto([
      { success: false, errorCode: 'service_unavailable', error: 'JasWave IA está muy ocupada ahora mismo.' },
      { success: true, content: 'listo', toolCalls: [] },
    ])
    const ult: UltimoErrorIA = {}
    const r = await chatDelMotor(ctx, cfg, ult, { delta: 'nunca', esperas: [1, 1] })(pedido)
    assert.equal(r.ok, true)
    assert.equal(r.texto, 'listo')
    assert.equal(llamadas(), 2)
    assert.equal(ult.error, undefined)
  })

  it('no insiste más de lo previsto ni con la cuota agotada', async () => {
    const ocupada = contexto([{ success: false, errorCode: 'service_unavailable', error: 'ocupada' }])
    const r = await chatDelMotor(ocupada.ctx, cfg, {}, { delta: 'nunca', esperas: [1, 1] })(pedido)
    assert.equal(r.ok, false)
    assert.equal(ocupada.llamadas(), 3)

    const cuota = contexto([{ success: false, errorCode: 'rate_limit', error: 'Has usado los 150 créditos de IA de hoy.' }])
    await chatDelMotor(cuota.ctx, cfg, {}, { delta: 'nunca', esperas: [1, 1] })(pedido)
    assert.equal(cuota.llamadas(), 1)
    assert.equal(esFalloPasajero({ success: false, errorCode: 'bad_request' }), false)
  })
})

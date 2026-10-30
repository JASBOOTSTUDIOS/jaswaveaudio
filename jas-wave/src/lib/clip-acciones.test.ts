import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loteAutoFade, loteConsolidar, loteInvertir, loteNormalizar, loteToggleMute } from './clip-acciones'

const p = {
  bpm: { valor: 120 },
  tracks: [
    {
      id: 'a',
      clips: [
        { id: 'm1', tipo: 'midi', inicio: 0, duracion: 4 },
        { id: 'm2', tipo: 'midi', inicio: 4, duracion: 4, silenciado: true },
        { id: 'w1', tipo: 'audio', inicio: 8, duracion: 4, source: { ruta: 'media/x.wav' }, clipInicio: 2 },
      ],
    },
    { id: 'b', clips: [{ id: 'w2', tipo: 'audio', inicio: 0, duracion: 8, inverso: true }] },
  ],
}

describe('clip-acciones', () => {
  it('mute: si alguno suena, silencia todos; si todos están silenciados, los activa', () => {
    const l = loteToggleMute(p, ['m1', 'm2'])
    assert.deepEqual((l[0]!.payload.cambios as Array<{ silenciado: boolean }>).map((c) => c.silenciado), [true, true])
    const l2 = loteToggleMute(p, ['m2'])
    assert.equal((l2[0]!.payload.cambios as Array<{ silenciado: boolean }>)[0]!.silenciado, false)
    assert.deepEqual(loteToggleMute(p, []), [])
  })

  it('fundido anti-clics solo en audio, entrada y salida', () => {
    const l = loteAutoFade(p, ['m1', 'w1'])
    assert.equal(l.length, 2)
    assert.deepEqual(l.map((c) => c.payload.tipo), ['in', 'out'])
    assert.equal(l[0]!.payload.duracion, 0.01)
  })

  it('consolidar agrupa por pista y tipo (necesita al menos 2)', () => {
    const l = loteConsolidar(p, ['m1', 'm2', 'w1', 'w2'])
    assert.deepEqual(l, [{ type: 'clip.merge', payload: { pistaId: 'a', clipIds: ['m1', 'm2'] } }])
  })

  it('invertir alterna según el estado de la selección', () => {
    const l = loteInvertir(p, ['w1', 'w2'])
    assert.deepEqual((l[0]!.payload.cambios as Array<{ inverso: boolean }>).map((c) => c.inverso), [true, true])
  })

  it('normalizar calcula la ganancia al pico −1 dBFS sobre la región visible', () => {
    let pedido: [string[], number, number] | null = null
    const { comandos, sinAudio } = loteNormalizar(p, ['w1', 'w2', 'm1'], (claves, desde, dur) => {
      if (claves[0] === 'media/x.wav') {
        pedido = [claves, desde, dur]
        return 0.5
      }
      return null
    })
    assert.equal(sinAudio, 1)
    assert.equal(comandos.length, 1)
    assert.equal(comandos[0]!.payload.gananciaDb, 5) // −1 − (−6,02) ≈ 5,0 dB
    assert.deepEqual(pedido!.slice(1), [1, 2]) // clipInicio 2 beats = 1 s, duración 4 beats = 2 s
  })
})

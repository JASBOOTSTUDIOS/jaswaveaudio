/**
 * Pedal unificado por canal (PSR-E373 y teclados con voz dual/split).
 * npx tsx --test src/lib/midi-pedal.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseMidiMessage, type MidiParsed } from './midi-bytes'
import { AgregadorPedales, esPedalConmutado, unificarPedal } from './midi-pedal'

/** Secuencia real capturada del PSR-E373 por WinMM (una pisada y una suelta). */
const PISADA = [
  [0xb0, 64, 127],
  [0xb1, 64, 127],
  [0xb2, 64, 0],
]
const SUELTA = [
  [0xb0, 64, 0],
  [0xb1, 64, 0],
  [0xb2, 64, 0],
]

function pasar(ag: AgregadorPedales, bytes: number[][]): MidiParsed[] {
  const out: MidiParsed[] = []
  for (const b of bytes) {
    const msg = parseMidiMessage(b).msg
    assert.ok(msg)
    const r = unificarPedal(ag, msg)
    if (r) out.push(r)
  }
  return out
}

describe('AgregadorPedales', () => {
  it('la pisada del PSR-E373 (127,127,0 en tres canales) deja el pedal abajo y reenvía un solo 127', () => {
    const ag = new AgregadorPedales()
    const salida = pasar(ag, PISADA)
    assert.equal(salida.length, 1)
    assert.equal(salida[0]?.kind, 'cc')
    if (salida[0]?.kind === 'cc') {
      assert.equal(salida[0].cc, 64)
      assert.equal(salida[0].value, 127)
    }
    assert.equal(ag.valor(64), 127)
  })

  it('soltar reenvía un único 0 y volver a pisar vuelve a sonar', () => {
    const ag = new AgregadorPedales()
    pasar(ag, PISADA)
    const suelta = pasar(ag, SUELTA)
    assert.equal(suelta.length, 1)
    if (suelta[0]?.kind === 'cc') assert.equal(suelta[0].value, 0)
    assert.equal(ag.valor(64), 0)
    const otra = pasar(ag, PISADA)
    assert.equal(otra.length, 1)
    if (otra[0]?.kind === 'cc') assert.equal(otra[0].value, 127)
  })

  it('repetir el mismo estado no genera mensajes (sin ráfagas hacia el VST)', () => {
    const ag = new AgregadorPedales()
    pasar(ag, PISADA)
    assert.deepEqual(pasar(ag, PISADA), [])
    pasar(ag, SUELTA)
    assert.deepEqual(pasar(ag, SUELTA), [])
  })

  it('medio pedal: el valor efectivo es el máximo entre canales', () => {
    const ag = new AgregadorPedales()
    const r1 = ag.aplicar({ cc: 64, value: 40, channel: 0 })
    assert.deepEqual(r1, { reenviar: true, valor: 40 })
    const r2 = ag.aplicar({ cc: 64, value: 90, channel: 1 })
    assert.deepEqual(r2, { reenviar: true, valor: 90 })
    // el canal 0 baja pero el 1 sigue a 90: no cambia nada
    assert.deepEqual(ag.aplicar({ cc: 64, value: 0, channel: 0 }), { reenviar: false, valor: 90 })
    assert.deepEqual(ag.aplicar({ cc: 64, value: 0, channel: 1 }), { reenviar: true, valor: 0 })
  })

  it('cada pedal se unifica por separado y el resto de CC pasa intacto', () => {
    const ag = new AgregadorPedales()
    assert.equal(esPedalConmutado(64), true)
    assert.equal(esPedalConmutado(66), true)
    assert.equal(esPedalConmutado(1), false)
    assert.deepEqual(ag.aplicar({ cc: 66, value: 127, channel: 2 }), { reenviar: true, valor: 127 })
    assert.equal(ag.valor(64), 0)
    const rueda = unificarPedal(ag, { kind: 'cc', channel: 5, cc: 1, value: 33 })
    assert.deepEqual(rueda, { kind: 'cc', channel: 5, cc: 1, value: 33 })
    const nota = unificarPedal(ag, { kind: 'noteOn', channel: 0, pitch: 60, velocity: 100 })
    assert.equal(nota?.kind, 'noteOn')
  })

  it('reiniciar olvida el estado', () => {
    const ag = new AgregadorPedales()
    pasar(ag, PISADA)
    ag.reiniciar()
    assert.equal(ag.valor(64), 0)
    assert.equal(pasar(ag, PISADA).length, 1)
  })
})

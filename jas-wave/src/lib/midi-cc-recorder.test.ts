/**
 * Captura de CC (pedal / expresión) al grabar y contrato de valor 0..1.
 * npx tsx --test src/lib/midi-cc-recorder.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseMidiMessage } from './midi-bytes'
import { AgregadorPedales, unificarPedal } from './midi-pedal'
import {
  ccGrabadosALanes,
  ccRecorderOn,
  createCcRecorder,
  esCcGrabable,
  valorCcAMidi,
} from './midi-cc-recorder'

const BPM = 120 // 0,5 s por beat
const base = { clipStartSec: 10, bpm: BPM, endSec: 20, duracionBeats: 20 }

describe('ccRecorder', () => {
  it('solo graba pedales y CC1/CC11; descarta repeticiones', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 7, 100, 11) // volumen: no
    r = ccRecorderOn(r, 64, 0, 10.5) // pedal suelto sin historial: no aporta
    r = ccRecorderOn(r, 64, 127, 11)
    r = ccRecorderOn(r, 64, 127, 11.2) // repetido
    r = ccRecorderOn(r, 64, 0, 12)
    assert.equal(r.events.length, 2)
    assert.ok(esCcGrabable(11) && !esCcGrabable(7))
  })

  it('pedal: puntos step normalizados 0..1, tiempo en beats relativos al clip', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 64, 127, 11) // beat 2
    r = ccRecorderOn(r, 64, 0, 12) // beat 4
    const [lane] = ccGrabadosALanes(r, base)
    assert.equal(lane!.cc, 64)
    assert.deepEqual(lane!.puntos.map((p) => [p.tiempo, p.valor, p.curva]), [[2, 1, 'step'], [4, 0, 'step']])
  })

  it('valor 127 → 1 (no 1/127) y medio pedal conserva su fracción', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 64, 64, 11)
    const [lane] = ccGrabadosALanes(r, base)
    assert.ok(Math.abs(lane!.puntos[0]!.valor - 64 / 127) < 1e-9)
    assert.equal(valorCcAMidi(lane!.puntos[0]!.valor), 64)
  })

  it('pedal ya pisado al empezar → punto inicial en 0 beats', () => {
    let r = createCcRecorder(10, new Map([[64, 127]]))
    r = ccRecorderOn(r, 64, 0, 12)
    const [lane] = ccGrabadosALanes(r, base)
    assert.deepEqual(lane!.puntos.map((p) => [p.tiempo, p.valor]), [[0, 1], [4, 0]])
  })

  it('pedal pisado y sin soltar al parar → punto final 0 en el fin de la toma', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 64, 127, 11)
    const [lane] = ccGrabadosALanes(r, { ...base, endSec: 13, duracionBeats: 8 })
    assert.deepEqual(lane!.puntos.map((p) => [p.tiempo, p.valor]), [[2, 1], [6, 0]])
  })

  it('el fin se recorta a la duración del clip', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 64, 127, 11)
    const [lane] = ccGrabadosALanes(r, { ...base, endSec: 30, duracionBeats: 5 })
    assert.equal(lane!.puntos.at(-1)!.tiempo, 5)
    assert.equal(lane!.puntos.at(-1)!.valor, 0)
  })

  it('punch: lo anterior se colapsa al estado inicial y lo posterior se descarta, con suelta al final', () => {
    let r = createCcRecorder(5)
    r = ccRecorderOn(r, 64, 127, 6) // antes del punch (pisado)
    r = ccRecorderOn(r, 64, 0, 12)
    r = ccRecorderOn(r, 64, 127, 14)
    r = ccRecorderOn(r, 64, 0, 18) // despues de la ventana
    const [lane] = ccGrabadosALanes(r, {
      clipStartSec: 10, bpm: BPM, endSec: 20, duracionBeats: 20,
      punch: { startSec: 10, endSec: 16 },
    })
    // inicial 1 (pisado antes del punch), suelta en beat 4, pisa en beat 8, suelta forzada al fin del punch (beat 12)
    assert.deepEqual(lane!.puntos.map((p) => [p.tiempo, p.valor]), [[0, 1], [4, 0], [8, 1], [12, 0]])
  })

  it('CC11 es lineal, no añade suelta y varios CC dan lanes separados y ordenados', () => {
    let r = createCcRecorder(10)
    r = ccRecorderOn(r, 11, 100, 10.5)
    r = ccRecorderOn(r, 64, 127, 11)
    r = ccRecorderOn(r, 11, 50, 11)
    r = ccRecorderOn(r, 64, 0, 12)
    const lanes = ccGrabadosALanes(r, base)
    assert.deepEqual(lanes.map((l) => l.cc), [11, 64])
    assert.equal(lanes[0]!.puntos.every((p) => p.curva === 'linear'), true)
    assert.equal(lanes[0]!.puntos.length, 2)
  })

  it('sin eventos: no hay lanes; un pedal solo suelto tampoco', () => {
    assert.deepEqual(ccGrabadosALanes(createCcRecorder(0), base), [])
  })

  it('PSR-E373: tras unificarPedal, una pisada y una suelta dan exactamente 127 y 0', () => {
    const ag = new AgregadorPedales()
    let r = createCcRecorder(0)
    const feed = (bytes: number[], t: number) => {
      const m = unificarPedal(ag, parseMidiMessage(bytes).msg!)
      if (m && m.kind === 'cc') r = ccRecorderOn(r, m.cc, m.value, t)
    }
    feed([0xb0, 0x40, 0x7f], 1)
    feed([0xb1, 0x40, 0x7f], 1)
    feed([0xb2, 0x40, 0x00], 1)
    feed([0xb0, 0x40, 0x00], 3)
    feed([0xb1, 0x40, 0x00], 3)
    const [lane] = ccGrabadosALanes(r, { clipStartSec: 0, bpm: BPM, endSec: 4, duracionBeats: 8 })
    assert.deepEqual(lane!.puntos.map((p) => [p.tiempo, p.valor]), [[2, 1], [6, 0]])
  })
})

describe('valorCcAMidi (contrato 0..1)', () => {
  it('0..1 → 0..127 y un 1 exacto es el máximo', () => {
    assert.equal(valorCcAMidi(0), 0)
    assert.equal(valorCcAMidi(1), 127)
    assert.equal(valorCcAMidi(0.5), 64)
  })
  it('datos antiguos en 0..127 (>1) se aceptan; NaN → 0', () => {
    assert.equal(valorCcAMidi(100), 100)
    assert.equal(valorCcAMidi(300), 127)
    assert.equal(valorCcAMidi(NaN), 0)
  })
})

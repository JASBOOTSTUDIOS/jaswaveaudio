/**
 * npx tsx --test src/lib/grooves/previsualizador.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PrevisualizadorGrooves, eventosEnVentana } from './previsualizador'

const notas = [
  { pitch: 36, velocidad: 100, inicio: 0, duracion: 0.25 },
  { pitch: 38, velocidad: 90, inicio: 2, duracion: 0.25 },
]

describe('previsualizador de grooves', () => {
  it('genera note-on y note-off en bucle al tempo del proyecto', () => {
    // 120 bpm = 500 ms por beat; bucle de 4 beats = 2000 ms.
    const ev = eventosEnVentana(notas, 4, 120, 0, 4000)
    const ons = ev.filter((e) => e.on)
    assert.deepEqual(
      ons.map((e) => [e.pitch, e.tMs]),
      [[36, 0], [38, 1000], [36, 2000], [38, 3000]],
    )
    assert.equal(ev.filter((e) => !e.on).length, 4)
  })

  it('los eventos no se duplican entre ventanas contiguas', () => {
    const a = eventosEnVentana(notas, 4, 100, 0, 700)
    const b = eventosEnVentana(notas, 4, 100, 700, 3000)
    const todos = eventosEnVentana(notas, 4, 100, 0, 3000)
    assert.equal(a.length + b.length, todos.length)
  })

  it('detener apaga las notas que quedaron sonando', async () => {
    const enviados: Array<[string, boolean, number]> = []
    let t = 0
    const p = new PrevisualizadorGrooves((pista, on, pitch) => (enviados.push([pista, on, pitch]), true), () => t)
    p.iniciar({ pistaId: 'bat', notas: [{ pitch: 49, velocidad: 100, inicio: 0, duracion: 3 }], largoBeats: 4, bpm: 120 })
    t = 100
    await new Promise((r) => setTimeout(r, 80))
    assert.ok(enviados.some((e) => e[1] && e[2] === 49))
    p.detener()
    assert.deepEqual(enviados.at(-1), ['bat', false, 49])
    assert.equal(p.activo, false)
  })
})

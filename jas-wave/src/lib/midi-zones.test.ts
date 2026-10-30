/**
 * Zonas MIDI en vivo (K3): destinos del host y seguimiento de note-off del thru.
 * npx tsx --test src/lib/midi-zones.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizarZona } from '../../../shared/src/types/directo'
import { SeguimientoNotasZona, buildLiveMidiTargets, firmaZonas, notasDeSalidaParaPista } from './midi-zones'

const zona = (id: string, pistaId: string, extra: Record<string, unknown> = {}) =>
  normalizarZona({ id, pistaId, lo: 0, hi: 127, ...extra })

describe('midi-zones · destinos del host', () => {
  it('sin zonas: una entrada de teclado completo por cada capa de la pista', () => {
    const { targets, recortado } = buildLiveMidiTargets([{ id: 'p', deviceId: 'winmm:0', slotIds: ['s1', 's2'] }], [])
    assert.equal(recortado, false)
    assert.deepEqual(
      targets.map((t) => [t.slotId, t.lo, t.hi, t.transpose, t.velCurve]),
      [
        ['s1', 0, 127, 0, 'lineal'],
        ['s2', 0, 127, 0, 'lineal'],
      ],
    )
    assert.equal(targets[0]!.deviceId, 'winmm:0')
  })

  it('con zonas: capas × zonas activas, canales en base 0 para el host', () => {
    const zonas = [
      zona('a', 'p', { lo: 0, hi: 59, transposicion: 12, canalEntrada: 1, canalSalida: 3 }),
      zona('b', 'p', { lo: 60, hi: 127, curvaVelocidad: 'dura', escalaVelocidad: 1.5 }),
      zona('c', 'p', { activa: false }),
      zona('d', 'otra'),
    ]
    const { targets } = buildLiveMidiTargets([{ id: 'p', deviceId: 'all', slotIds: ['s1', 's2'] }], zonas)
    assert.equal(targets.length, 4)
    assert.deepEqual(targets[0], { slotId: 's1', deviceId: 'all', lo: 0, hi: 59, transpose: 12, velCurve: 'lineal', velScale: 1, velFixed: 100, channel: 0, outChannel: 2 })
    assert.deepEqual(targets[1], { slotId: 's1', deviceId: 'all', lo: 60, hi: 127, transpose: 0, velCurve: 'dura', velScale: 1.5, velFixed: 100 })
    assert.equal(targets[2]!.slotId, 's2')
  })

  it('se recorta a 32 destinos', () => {
    const pistas = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, deviceId: 'all', slotIds: ['s'] }))
    const { targets, recortado } = buildLiveMidiTargets(pistas, [])
    assert.equal(targets.length, 32)
    assert.equal(recortado, true)
  })

  it('la firma cambia con cualquier campo de la zona', () => {
    const a = [zona('a', 'p', { transposicion: 0 })]
    const b = [zona('a', 'p', { transposicion: 1 })]
    assert.notEqual(firmaZonas(a), firmaZonas(b))
    assert.equal(firmaZonas([]), '')
  })
})

describe('midi-zones · thru web con seguimiento de note-off', () => {
  it('el note-off va al tono que sonó aunque la zona cambie mientras la tecla sigue pisada', () => {
    const seg = new SeguimientoNotasZona()
    const antes = [zona('a', 'p', { transposicion: 12 })]
    const despues = [zona('a', 'p', { transposicion: -12 })]
    const on = notasDeSalidaParaPista(antes, 'p', 60, 100).map((n) => n.pitch)
    assert.deepEqual(on, [72])
    assert.deepEqual(seg.noteOn('p', 60, on), [])
    // Cambia la transposición con la tecla pisada.
    const off = seg.noteOff('p', 60) ?? notasDeSalidaParaPista(despues, 'p', 60, 0).map((n) => n.pitch)
    assert.deepEqual(off, [72])
    // Sin nota en curso se usa el reparto actual.
    assert.equal(seg.noteOff('p', 60), null)
  })

  it('repetir la misma tecla sin soltar devuelve los tonos anteriores para apagarlos', () => {
    const seg = new SeguimientoNotasZona()
    assert.deepEqual(seg.noteOn('p', 60, [60, 72]), [])
    assert.deepEqual(seg.noteOn('p', 60, [60]), [60, 72])
    seg.reiniciar()
    assert.equal(seg.noteOff('p', 60), null)
  })
})

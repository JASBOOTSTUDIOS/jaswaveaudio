/**
 * Legato worship al escribir: la guardia sostiene las notas de las pistas afinadas hasta 500 ms después de la
 * siguiente (pads: 1 s), deja la batería, solo actúa en pedidos de adoración y no provoca avisos de coherencia.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { esPedidoWorship, guardarEscrituraLegato, guardiaLegato, legatoActivo } from '../src/motor/turno/legato-banda'
import { analizarCoherencia, diagnosticoEscritura, type HojaCoherencia } from '../src/motor/turno/coherencia-banda'

const staccato = [0, 1, 2, 3].map((i) => ({ pitch: 60 + i, inicio: i, duracion: 0.25, velocidad: 80 }))

describe('legato worship al escribir', () => {
  it('detecta pedidos de adoración, alabanza y balada', () => {
    assert.ok(esPedidoWorship('Haz una canción de adoración en Re'))
    assert.ok(esPedidoWorship('worship lento'))
    assert.ok(esPedidoWorship('una balada de alabanza'))
    assert.ok(!esPedidoWorship('rock duro con distorsión'))
    assert.ok(legatoActivo('rock', 'siempre'))
    assert.ok(!legatoActivo('worship', 'nunca'))
  })

  it('melodía staccato: sostiene hasta 500 ms después de la siguiente (60 bpm) y avisa', () => {
    const r = guardiaLegato('midi.clip.create', { notas: staccato }, { tipo: 'afinada', bpm: 60, finClip: 16 })
    const notas = r.args.notas as Array<{ inicio: number; duracion: number; velocidad: number }>
    assert.equal(notas[0]!.duracion, 1.5)
    assert.equal(notas[2]!.duracion, 1.5)
    assert.equal(notas[3]!.duracion, 0.25)
    assert.equal(notas[0]!.velocidad, 80)
    assert.match(r.avisos[0]!, /legato worship: 3 notas sostenidas hasta 500 ms después de la siguiente/)
  })

  it('respeta las claves en inglés del modelo y no muta la entrada', () => {
    const entrada = [{ note: 'C4', start: 0, duration: 0.25 }, { note: 'D4', start: 2, duration: 0.25 }]
    const r = guardiaLegato('midi.notes.set', { notes: entrada }, { tipo: 'afinada', bpm: 120 })
    assert.equal((r.args.notes as Array<{ duration: number }>)[0]!.duration, 3)
    assert.equal(entrada[0]!.duration, 0.25)
  })

  it('la batería no se toca; el pad llega al final del clip', () => {
    assert.deepEqual(guardiaLegato('midi.clip.create', { notas: staccato }, { tipo: 'bateria', bpm: 120 }), { args: { notas: staccato }, avisos: [] })
    const pad = [{ pitch: 48, inicio: 0, duracion: 4 }, { pitch: 50, inicio: 8, duracion: 4 }]
    const r = guardiaLegato('midi.clip.create', { notas: pad }, { tipo: 'pad', bpm: 120, finClip: 16 })
    const n = r.args.notas as Array<{ duracion: number }>
    assert.equal(n[0]!.duracion, 10)
    assert.equal(n[1]!.duracion, 8)
  })

  it('sobre el estado: solo con pedido worship, por tipo de pista y con el bpm y el clip del proyecto', () => {
    const st = { project: { bpm: 74, tracks: [{ id: 'p1', nombre: 'Piano', clips: [{ id: 'c1', inicio: 0, duracion: 16 }] }, { id: 'p2', nombre: 'Batería', clips: [] }] } }
    const llamada = { nombre: 'midi.notes.set', argumentos: { pistaId: 'p1', clipId: 'c1', notas: staccato } }
    const w = guardarEscrituraLegato(st, 'canción de adoración', llamada, 'worship')
    const d = (w.args.notas as Array<{ duracion: number }>)[0]!.duracion
    assert.ok(Math.abs(d - (1 + (500 * 74) / 60000 + 0)) < 1e-5)
    assert.equal(guardarEscrituraLegato(st, 'rock', llamada, 'worship').avisos.length, 0)
    assert.equal(guardarEscrituraLegato(st, 'adoración', { ...llamada, argumentos: { ...llamada.argumentos, pistaId: 'p2' } }, 'worship').avisos.length, 0)
  })

  it('no genera avisos de coherencia: ni cuadrada, ni después del final, ni rejilla', () => {
    const hoja: HojaCoherencia = { tonalidad: 'Do mayor', numerador: 4, secciones: [{ nombre: 'Intro', compases: 4, acordes: ['C'] }] }
    // Melodía variada de 16 notas (compases 1-4) en la rejilla.
    const ritmos = [0, 1, 1.5, 2, 3, 4, 5, 5.5, 6, 7, 8, 9, 9.5, 10, 11, 12]
    const base = ritmos.map((t, i) => ({ pitch: [60, 64, 67, 64][i % 4]!, inicio: t, duracion: 0.25, velocidad: 70 + (i % 5) * 9 }))
    const r = guardiaLegato('midi.clip.create', { notas: base }, { tipo: 'afinada', bpm: 100, finClip: 16 })
    const estado = (notas: unknown[]) => ({ project: { bpm: 100, tracks: [{ id: 'p1', nombre: 'Piano', clips: [{ nombre: 'Intro', inicio: 0, duracion: 16, notas }] }] } }) as never
    const antes = analizarCoherencia(estado(base), hoja).detalles
    const despues = analizarCoherencia(estado(r.args.notas as unknown[]), hoja).detalles
    assert.deepEqual(despues.filter((x) => /después del final|rejilla/.test(x)), antes.filter((x) => /después del final|rejilla/.test(x)))
    assert.ok(!despues.some((x) => /robótica/.test(x)) || antes.some((x) => /robótica/.test(x)))
    const diag = diagnosticoEscritura(estado(r.args.notas as unknown[]), hoja, { pista: 'Piano', encargo: 'Intro' }) ?? ''
    assert.ok(!/cuadrada/.test(diag), diag)
  })
})

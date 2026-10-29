import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ajustarAEscala,
  alternarMute,
  cortarNotas,
  idsDelTono,
  transformarNotas,
  transponerEnEscala,
  type NotaPR,
} from './piano-roll-ops'

const n = (id: string, pitch: number, inicio: number, duracion: number, extra: Partial<NotaPR> = {}): NotaPR => ({
  id,
  pitch,
  inicio,
  duracion,
  velocidad: 100,
  ...extra,
})

let k = 0
const nuevoId = () => `nuevo-${++k}`

describe('piano-roll-ops', () => {
  it('la tijera corta solo las notas que cruzan el punto y conserva mute y velocidad', () => {
    const notas = [n('a', 60, 0, 4, { mute: true, velocidad: 70 }), n('b', 64, 2.5, 1), n('c', 67, 0, 1)]
    const r = cortarNotas(notas, 2, {}, nuevoId)
    assert.equal(r.cortadas, 1)
    assert.deepEqual(
      r.notas.filter((x) => x.pitch === 60).map((x) => [x.inicio, x.duracion, x.mute, x.velocidad]),
      [
        [0, 2, true, 70],
        [2, 2, true, 70],
      ],
    )
    assert.equal(r.nuevosIds.length, 1)
  })

  it('arrastre vertical: solo el rango de tonos indicado', () => {
    const acorde = [n('a', 60, 0, 4), n('b', 64, 0, 4), n('c', 72, 0, 4)]
    const r = cortarNotas(acorde, 1, { pitchMin: 60, pitchMax: 65 }, nuevoId)
    assert.equal(r.cortadas, 2)
    assert.equal(r.notas.length, 5)
  })

  it('mute alterna según la selección', () => {
    const notas = [n('a', 60, 0, 1), n('b', 62, 1, 1, { mute: true })]
    assert.deepEqual(alternarMute(notas, new Set(['a', 'b'])).map((x) => x.mute), [true, true])
    assert.deepEqual(alternarMute(notas, new Set(['b'])).map((x) => x.mute), [undefined, false])
  })

  it('selección por tono', () => {
    assert.deepEqual(idsDelTono([n('a', 36, 0, 1), n('b', 38, 1, 1), n('c', 36, 2, 1)], 36), ['a', 'c'])
  })

  it('transformaciones conservan mute y respetan la selección; humanizar es determinista', () => {
    const notas = [n('a', 60, 0, 1, { mute: true }), n('b', 62, 2, 1)]
    const st = transformarNotas('stretchDouble', notas, new Set())
    assert.deepEqual(st.map((x) => [x.inicio, x.duracion]), [
      [0, 2],
      [4, 2],
    ])
    assert.equal(st[0]!.mute, true)
    const solo = transformarNotas('staccato', notas, new Set(['b']))
    assert.equal(solo.find((x) => x.id === 'a')!.duracion, 1)
    assert.equal(solo.find((x) => x.id === 'b')!.duracion, 0.5)
    const h1 = transformarNotas('humanize', notas, new Set(), { seed: 9 })
    const h2 = transformarNotas('humanize', notas, new Set(), { seed: 9 })
    assert.deepEqual(h1, h2)
  })

  it('escala: ajusta al grado más cercano y transpone por grados', () => {
    const doMayor = { raiz: 0, tipo: 'major' as const }
    assert.equal(ajustarAEscala(61, doMayor, true), 62) // C# → D
    assert.equal(ajustarAEscala(61, doMayor, false), 61)
    assert.equal(transponerEnEscala(64, 1, doMayor, true), 65) // E → F
    assert.equal(transponerEnEscala(65, 1, doMayor, true), 67) // F → (F# fuera) → G
    assert.equal(transponerEnEscala(60, -1, doMayor, true), 59) // C → B
  })
})

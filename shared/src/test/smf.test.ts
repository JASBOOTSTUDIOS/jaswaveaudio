import { describe, expect, it } from 'vitest'
import { escribirSmf, leerSmf, proyectoASmf } from '../midi/smf'

const proyecto = {
  nombre: 'Canción',
  bpm: { valor: 96 },
  timeSignature: { numerador: 6, denominador: 8 },
  marcadores: [{ nombre: 'Coro', tiempo: 16 }],
  tracks: [
    {
      id: 'p',
      nombre: 'Piano',
      clips: [
        {
          id: 'c1',
          tipo: 'midi',
          inicio: 4,
          duracion: 4,
          notas: [
            { pitch: 60, velocidad: 90, inicio: 0, duracion: 1 },
            { pitch: 64, velocidad: 80, inicio: 1, duracion: 1, mute: true },
            { pitch: 67, velocidad: 70, inicio: 3, duracion: 5 }, // sobresale del clip: se recorta
            { pitch: 72, velocidad: 70, inicio: 6, duracion: 1 }, // fuera del clip: no suena
          ],
        },
        { id: 'audio', tipo: 'audio', inicio: 0, duracion: 8 },
      ],
    },
    { id: 'b', nombre: 'Batería', clips: [{ id: 'c2', tipo: 'midi', inicio: 0, duracion: 2, notas: [{ pitch: 36, velocidad: 110, inicio: 0, duracion: 0.25 }] }] },
    { id: 'v', nombre: 'Voz', clips: [{ id: 'c3', tipo: 'audio', inicio: 0, duracion: 8 }] },
  ],
}

describe('SMF', () => {
  it('ida y vuelta: tempo, compás, marcadores, nombres y notas', () => {
    const smf = proyectoASmf(proyecto)
    const leido = leerSmf(escribirSmf(smf))
    expect(leido.ppq).toBe(480)
    expect(leido.bpm).toBeCloseTo(96, 3)
    expect(leido.compas).toEqual({ numerador: 6, denominador: 8 })
    expect(leido.titulo).toBe('Canción')
    expect(leido.marcadores).toEqual([{ nombre: 'Coro', inicio: 16 }])
    expect(leido.pistas.map((p) => p.nombre)).toEqual(['Piano', 'Batería'])
    const piano = leido.pistas[0]!
    expect(piano.notas).toEqual([
      { pitch: 60, velocidad: 90, inicio: 4, duracion: 1 },
      { pitch: 67, velocidad: 70, inicio: 7, duracion: 1 },
    ])
  })

  it('la batería va al canal 10 y el resto evita el 10', () => {
    const smf = proyectoASmf(proyecto)
    expect(smf.pistas.find((p) => p.nombre === 'Batería')!.canal).toBe(9)
    expect(smf.pistas.find((p) => p.nombre === 'Piano')!.canal).not.toBe(9)
  })

  it('exporta un solo clip desde el beat 0', () => {
    const smf = proyectoASmf(proyecto, { clipId: 'c1', clipDesdeCero: true })
    expect(smf.pistas).toHaveLength(1)
    expect(smf.pistas[0]!.notas[0]!.inicio).toBe(0)
    expect(smf.marcadores).toEqual([])
  })

  it('notas repetidas en el mismo tick no se pisan (note-off antes que note-on)', () => {
    const bin = escribirSmf({
      bpm: 120,
      pistas: [{ nombre: 'x', canal: 0, notas: [{ pitch: 60, velocidad: 100, inicio: 0, duracion: 1 }, { pitch: 60, velocidad: 100, inicio: 1, duracion: 1 }] }],
    })
    expect(leerSmf(bin).pistas[0]!.notas).toHaveLength(2)
  })
})

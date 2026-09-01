import { describe, expect, it } from 'vitest'
import { buildStyleGapReport } from '../ask/style-gap-report'
import type { DAWState } from '@jaswave/shared'

function miniState(): DAWState {
  return {
    project: {
      id: 'p1',
      nombre: 'Demo',
      bpm: { valor: 120, automatico: false },
      timeSignature: { numerador: 4, denominador: 4 },
      tracks: [
        {
          id: 't1',
          nombre: 'Batería',
          tipo: 'midi',
          tags: ['role:drums'],
          plugins: [{ nombre: 'MT-PowerDrumKit' }],
          clips: [
            {
              id: 'c1',
              nombre: 'Batería',
              tipo: 'midi',
              trackId: 't1',
              inicio: 0,
              duracion: 64,
              notas: [
                { id: 'n1', pitch: 36, inicio: 0, duracion: 0.25, velocidad: 100 },
                { id: 'n2', pitch: 38, inicio: 1, duracion: 0.25, velocidad: 110 },
                { id: 'n3', pitch: 42, inicio: 0.5, duracion: 0.2, velocidad: 70 },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as DAWState
}

describe('buildStyleGapReport', () => {
  it('habla en lenguaje de productor, no P1/P2 ni 244.0b', () => {
    const text = buildStyleGapReport(miniState(), {
      userText:
        'analizame la pista de la bateria y dime que le falta para estilo averly morillo worship, investiga en internet',
    })
    expect(text).toMatch(/Batería/)
    expect(text).toMatch(/ghost notes|Ghost|hi-hat|Hi-hat/i)
    expect(text).not.toMatch(/\*\*P[123]\*\*/)
    expect(text).not.toMatch(/244\.0b/)
    expect(text).not.toMatch(/formulario/)
    expect(text).toMatch(/Qué le falta|Qué pediste/)
  })
})

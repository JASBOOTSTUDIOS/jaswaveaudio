import { describe, it, expect } from 'vitest'
import { evaluateMidiQuality } from '../quality/midi-quality-gate'
import { evaluateArrangementQuality } from '../quality/arrangement-quality-gate'
import { evaluateRenderQuality } from '../quality/render-quality-gate'
import type { DAWState } from '@jaswave/shared'

describe('quality gates', () => {
  it('MIDI vacío en pista mutada es fail', () => {
    const state = {
      project: {
        tracks: [
          {
            id: 't1',
            nombre: 'Bajo',
            tipo: 'midi',
            clips: [{ id: 'c1', nombre: 'Vacío', duracion: 16, notas: [] }],
          },
        ],
      },
    } as unknown as DAWState
    const r = evaluateMidiQuality({ state, mutatedMidi: true })
    expect(r.verdict).toBe('fail')
  })

  it('arrangement sin gaps en proyecto vacío no falla duro', () => {
    const state = { project: { tracks: [], marcadores: [] } } as unknown as DAWState
    const r = evaluateArrangementQuality(state)
    expect(r.verdict === 'pass' || r.verdict === 'warning').toBe(true)
  })

  it('render respeta listen/compareTarget', () => {
    const r = evaluateRenderQuality({
      requireListen: true,
      sectionsCovered: true,
      builtOrMutated: true,
      hasMidiClips: true,
      lastListen: { ok: false, issues: ['clip'] },
    })
    expect(r.verdict).toBe('fail')
  })
})

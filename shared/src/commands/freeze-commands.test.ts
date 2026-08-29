import { describe, it, expect } from 'vitest'
import {
  encodeFrozenComment,
  parseFrozenComment,
  crearComandoTrackFreeze,
  crearComandoTrackUnfreeze,
} from '../commands/freeze-commands'
import { crearEstadoInicial } from '../state/estado-inicial'
import type { DAWState } from '../types/state'
import type { Track } from '../types/tracks'

function trackWithPlugins(): Track {
  return {
    id: 't1',
    nombre: 'T1',
    tipo: 'midi',
    frozen: false,
    plugins: [
      { id: 'a', nombre: 'A', bypass: true },
      { id: 'b', nombre: 'B', bypass: false },
    ],
  } as Track
}

describe('freeze-commands bypass snapshot', () => {
  it('encode/parse roundtrip', () => {
    const c = encodeFrozenComment('/a.wav', { p1: true, p2: false })
    expect(parseFrozenComment(c)).toEqual({
      audioPath: '/a.wav',
      bypassByPluginId: { p1: true, p2: false },
    })
  })

  it('unfreeze restaura bypass previos', () => {
    const base = crearEstadoInicial() as DAWState
    let state: DAWState = {
      ...base,
      project: { ...base.project, tracks: [trackWithPlugins()] },
    }

    const freeze = crearComandoTrackFreeze()
    const fr = freeze.handler(state, { trackId: 't1', audioPath: '/x.wav' }) as {
      state: DAWState
    }
    state = fr.state
    expect(state.project.tracks[0]!.frozen).toBe(true)
    expect(state.project.tracks[0]!.plugins!.every((p) => p.bypass)).toBe(true)

    const unfreeze = crearComandoTrackUnfreeze()
    const uf = unfreeze.handler(state, { trackId: 't1' }) as { state: DAWState }
    state = uf.state
    expect(state.project.tracks[0]!.frozen).toBe(false)
    const byId = Object.fromEntries(state.project.tracks[0]!.plugins!.map((p) => [p.id, p.bypass]))
    expect(byId).toEqual({ a: true, b: false })
  })
})

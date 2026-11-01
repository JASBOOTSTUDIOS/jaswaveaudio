import { describe, expect, it } from 'vitest'
import { crearEstadoInicial } from '../state/estado-inicial'
import { crearComandoTrackCreate } from '../commands/domain-commands'
import {
  crearComandoTakeFolderEnsure,
  crearComandoTakeAdd,
  crearComandoCompSegmentSet,
} from '../commands/take-commands'
import type { DAWState } from '../types/state'

function estadoConPistaAudio() {
  const base = crearEstadoInicial()
  const created = crearComandoTrackCreate().handler(base, { nombre: 'Voz', tipo: 'audio' }) as {
    state: DAWState
  }
  const tracks = created.state.project.tracks
  const trackId = tracks[tracks.length - 1]!.id
  return { estado: created.state, trackId }
}

describe('take/comp commands', () => {
  it('take.folder.ensure crea carpeta por pista', () => {
    const { estado, trackId } = estadoConPistaAudio()
    const cmd = crearComandoTakeFolderEnsure()
    const r = cmd.handler(estado, { pistaId: trackId }) as {
      state: DAWState
      result?: { folderId?: string }
    }
    expect(r.result?.folderId).toBeTruthy()
    expect(r.state.project.takeFolders?.length).toBe(1)
    expect(r.state.project.tracks.find((t) => t.id === trackId)?.takeFolderId).toBe(
      r.result?.folderId,
    )
  })

  it('take.add + comp.segment.set', () => {
    const { estado: base, trackId } = estadoConPistaAudio()
    const folderR = crearComandoTakeFolderEnsure().handler(base, { pistaId: trackId }) as {
      state: DAWState
    }
    const added = crearComandoTakeAdd().handler(folderR.state, {
      pistaId: trackId,
      archivo: 'C:/rec/take1.wav',
      inicioGrabacion: 0,
      finGrabacion: 4,
    }) as { state: DAWState; result?: { takeId?: string } }
    const takeId = added.result?.takeId
    expect(takeId).toBeTruthy()
    const seg = crearComandoCompSegmentSet().handler(added.state, {
      pistaId: trackId,
      takeId: takeId!,
      timelineInicio: 0,
      timelineFin: 4,
      origenInicio: 0,
      origenFin: 2,
    }) as { state: DAWState }
    expect(seg.state.project.takeFolders?.[0]?.segments.length).toBe(1)
  })
})

/**
 * Utilidades de proyecto sobre el agent bridge: crear pista MIDI con clip y leer el estado.
 */
import type { BridgeClient } from './app'
import { waitFor } from './app'

export type TrackSummary = {
  id: string
  nombre: string
  tipo: string
  clips: Array<{ id: string; nombre?: string; tipo?: string; inicio: number; duracion: number; notas: number }>
}

export const E2E_NOTES = [
  { pitch: 60, inicio: 0, duracion: 1, velocidad: 100 },
  { pitch: 64, inicio: 1, duracion: 1, velocidad: 96 },
  { pitch: 67, inicio: 2, duracion: 1, velocidad: 92 },
  { pitch: 72, inicio: 3, duracion: 1, velocidad: 110 },
]

export async function tracks(bridge: BridgeClient): Promise<TrackSummary[]> {
  const st = await bridge.state()
  return (st.tracks ?? []) as TrackSummary[]
}

export async function findTrack(bridge: BridgeClient, nombre: string): Promise<TrackSummary | undefined> {
  return (await tracks(bridge)).find((t) => t.nombre === nombre)
}

/** project.new limpio (con reintento: tras el arranque el proyecto puede estar aún inicializándose). */
export async function newProject(bridge: BridgeClient, nombre: string): Promise<void> {
  await waitFor(
    'project.new',
    async () => {
      const res = await bridge.actions([{ type: 'project.new', payload: { nombre } }])
      if (!res.results?.[0]?.success) return false
      const st = await bridge.state()
      return st.nombre === nombre
    },
    60_000,
    1000,
  )
}

/** Crea una pista MIDI con un clip de 4 notas. Devuelve ids. */
export async function createMidiTrackWithClip(
  bridge: BridgeClient,
  trackName: string,
  clipName = 'E2E Clip',
): Promise<{ trackId: string; clipId: string }> {
  await bridge.run('track.create', { nombre: trackName, tipo: 'midi' })
  const track = await waitFor('pista creada', () => findTrack(bridge, trackName), 20_000)
  await bridge.run('midi.clip.create', {
    pistaId: track.id,
    nombre: clipName,
    inicio: 0,
    duracion: 4,
    notas: E2E_NOTES,
    audition: false,
  })
  const withClip = await waitFor(
    'clip MIDI creado',
    async () => {
      const t = await findTrack(bridge, trackName)
      return t?.clips.find((c) => c.nombre === clipName) ? t : null
    },
    20_000,
  )
  return { trackId: withClip.id, clipId: withClip.clips.find((c) => c.nombre === clipName)!.id }
}

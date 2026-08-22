import type { DAWState } from '../../../shared/src/types/state'

/** Pista activa desde selección (pista, idPrincipal o clip). */
export function getSelectedTrackId(state: DAWState): string | null {
  const tracks = state.project?.tracks ?? []
  const idsPistas = state.selection?.idsPistas ?? []
  if (idsPistas[0] && tracks.some((t) => t.id === idsPistas[0])) return idsPistas[0]!

  const principal = state.selection?.idPrincipal
  if (principal && tracks.some((t) => t.id === principal)) return principal

  const clipId = state.selection?.idsClips?.[0]
  if (!clipId) return null
  for (const t of tracks) {
    if ((t.clips ?? []).some((c) => c.id === clipId)) return t.id
  }
  return null
}

export function selectTrackPayload(trackId: string) {
  return {
    tipo: 'pista' as const,
    ids: [trackId],
    idsPistas: [trackId],
    idsClips: [] as string[],
    idPrincipal: trackId,
    limpiar: true,
  }
}

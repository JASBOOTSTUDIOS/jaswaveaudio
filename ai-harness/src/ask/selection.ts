/**
 * Selección de pista/clip desde DAWState (solo lectura).
 */

import type { DAWState } from '@jaswave/shared'

function isMidiClip(c: { tipo?: string } | undefined): boolean {
  return c?.tipo === 'midi'
}

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

export function resolvePianoRollClip(
  state: DAWState,
  hint?: { trackId?: string | null; clipId?: string | null },
): { trackId: string; clipId: string } | null {
  const tracks = state.project?.tracks ?? []
  const findMidi = (trackId: string, clipId: string) => {
    const t = tracks.find((x) => x.id === trackId)
    const c = (t?.clips ?? []).find((x) => x.id === clipId)
    return t && c && isMidiClip(c) ? { trackId: t.id, clipId: c.id } : null
  }
  const firstMidiOnTrack = (trackId: string) => {
    const t = tracks.find((x) => x.id === trackId)
    const c = (t?.clips ?? []).find((x) => isMidiClip(x))
    return t && c ? { trackId: t.id, clipId: c.id } : null
  }
  const firstMidiInProject = () => {
    for (const t of tracks) {
      const c = (t.clips ?? []).find((x) => isMidiClip(x))
      if (c) return { trackId: t.id, clipId: c.id }
    }
    return null
  }

  if (hint?.clipId) {
    for (const t of tracks) {
      const hit = findMidi(t.id, hint.clipId)
      if (hit) return hit
    }
  }
  const selClip = state.selection?.idsClips?.[0]
  if (selClip) {
    for (const t of tracks) {
      const hit = findMidi(t.id, selClip)
      if (hit) return hit
    }
  }
  const preferred = hint?.trackId || state.selection?.idPrincipal || state.selection?.idsPistas?.[0]
  if (preferred) {
    const hit = firstMidiOnTrack(preferred)
    if (hit) return hit
  }
  return firstMidiInProject()
}

export function listMidiClips(state: DAWState): Array<{ trackId: string; clipId: string; label: string }> {
  const out: Array<{ trackId: string; clipId: string; label: string }> = []
  for (const t of state.project?.tracks ?? []) {
    for (const c of t.clips ?? []) {
      if (!isMidiClip(c)) continue
      const name = (c as { nombre?: string }).nombre || 'Clip MIDI'
      out.push({ trackId: t.id, clipId: c.id, label: `${t.nombre || t.id} · ${name}` })
    }
  }
  return out
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

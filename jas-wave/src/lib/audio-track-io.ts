/**
 * Ruteo de audio por pista: dispositivo de entrada + monitor + armado (grabación).
 * dispositivoEntrada vacío = dispositivo por defecto del sistema.
 */

export function isAudioRecordTrack(tipo: string | undefined): boolean {
  return tipo === 'audio'
}

export type AudioRouteTrack = {
  id: string
  tipo?: string
  armada?: boolean
  dispositivoEntrada?: string
  entrada?: string
  configuracion?: { monitorizarEntrada?: boolean }
}

export function audioInputOf(track: object): string {
  if (track && typeof track === 'object' && 'dispositivoEntrada' in track) {
    const v = (track as { dispositivoEntrada?: unknown }).dispositivoEntrada
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  if (track && typeof track === 'object' && 'entrada' in track) {
    const v = (track as { entrada?: unknown }).entrada
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

export function toAudioRouteTrack(track: {
  id: string
  tipo?: string
  armada?: boolean
  configuracion?: { monitorizarEntrada?: boolean }
}): AudioRouteTrack {
  return {
    id: track.id,
    tipo: track.tipo,
    armada: track.armada,
    dispositivoEntrada: audioInputOf(track),
    configuracion: { monitorizarEntrada: Boolean(track.configuracion?.monitorizarEntrada) },
  }
}

export function assignedAudioInput(track: AudioRouteTrack): string {
  return audioInputOf(track)
}

/** Clave de sesión: '' = micrófono por defecto. */
export function audioDeviceKey(deviceId: string | undefined | null): string {
  return (deviceId ?? '').trim()
}

export function audioRecordTargetIds(tracks: AudioRouteTrack[]): string[] {
  return tracks.filter((t) => isAudioRecordTrack(t.tipo) && Boolean(t.armada)).map((t) => t.id)
}

export function audioMonitorTargetIds(tracks: AudioRouteTrack[]): string[] {
  return tracks
    .filter((t) => isAudioRecordTrack(t.tipo) && Boolean(t.configuracion?.monitorizarEntrada))
    .map((t) => t.id)
}

/** Agrupa pistas armadas por dispositivo de entrada. */
export function groupArmedAudioByDevice(tracks: AudioRouteTrack[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const t of tracks) {
    if (!isAudioRecordTrack(t.tipo) || !t.armada) continue
    const key = audioDeviceKey(assignedAudioInput(t))
    const list = map.get(key)
    if (list) list.push(t.id)
    else map.set(key, [t.id])
  }
  return map
}

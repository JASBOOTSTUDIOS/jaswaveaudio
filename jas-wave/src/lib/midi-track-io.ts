/**
 * Ruteo MIDI por pista: dispositivo asignado + monitor (thru) + armado (grabación).
 * Sin asignación o con monitor apagado, el controlador no suena en esa pista.
 * Pistas audio también pueden recibir MIDI (estilo Reaper: instrumento en cadena FX).
 */

/** Puede recibir MIDI live / grabación / clips MIDI. */
export function isMidiLikeTrack(tipo: string | undefined): boolean {
  return tipo === 'midi' || tipo === 'instrumento' || tipo === 'audio'
}

/** Alias explícito para UI / IA. */
export function canReceiveMidi(tipo: string | undefined): boolean {
  return isMidiLikeTrack(tipo)
}

export type MidiRouteTrack = {
  id: string
  tipo?: string
  armada?: boolean
  entrada?: string
  configuracion?: { monitorizarEntrada?: boolean }
}

export function midiInputOf(track: object): string {
  if (!('entrada' in track)) return ''
  const value = (track as { entrada?: unknown }).entrada
  return typeof value === 'string' ? value.trim() : ''
}

export function toMidiRouteTrack(track: {
  id: string
  tipo?: string
  armada?: boolean
  configuracion?: { monitorizarEntrada?: boolean }
}): MidiRouteTrack {
  return {
    id: track.id,
    tipo: track.tipo,
    armada: track.armada,
    entrada: midiInputOf(track),
    configuracion: { monitorizarEntrada: Boolean(track.configuracion?.monitorizarEntrada) },
  }
}

export function assignedMidiDevice(track: MidiRouteTrack): string {
  return midiInputOf(track)
}

export function trackMatchesMidiDevice(track: MidiRouteTrack, deviceId: string): boolean {
  const assigned = assignedMidiDevice(track)
  if (!assigned) return false
  if (assigned === 'all') return true
  return assigned === deviceId
}

/** Thru en vivo: monitor ON y dispositivo asignado (y coincidente). */
export function midiLiveTargetIds(tracks: MidiRouteTrack[], deviceId: string): string[] {
  return tracks
    .filter(
      (t) =>
        isMidiLikeTrack(t.tipo) &&
        Boolean(t.configuracion?.monitorizarEntrada) &&
        trackMatchesMidiDevice(t, deviceId),
    )
    .map((t) => t.id)
}

/** Grabación: armada y dispositivo coincidente (aunque el monitor esté off). */
export function midiRecordTargetIds(tracks: MidiRouteTrack[], deviceId: string): string[] {
  return tracks
    .filter((t) => isMidiLikeTrack(t.tipo) && Boolean(t.armada) && trackMatchesMidiDevice(t, deviceId))
    .map((t) => t.id)
}

/** Pistas monitorizadas con algún dispositivo — destinos live nativos. */
export function midiNativeLiveTargetIds(tracks: MidiRouteTrack[]): string[] {
  return tracks
    .filter(
      (t) =>
        isMidiLikeTrack(t.tipo) &&
        Boolean(t.configuracion?.monitorizarEntrada) &&
        assignedMidiDevice(t).length > 0,
    )
    .map((t) => t.id)
}

export function parseWinmmPort(deviceId: string): number {
  const m = /^winmm:(\d+)$/i.exec(deviceId.trim())
  if (!m) return -1
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 0 ? n : -1
}

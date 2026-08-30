/**
 * Portapapeles interno del DAW (clips MIDI / audio).
 */

export type ClipboardMidiNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal?: number
}

export type ClipboardClip = {
  pistaOrigenId: string
  nombre: string
  inicio: number
  duracion: number
  /** 'midi' | 'audio' | … */
  tipo?: string
  color?: string
  /** Notas MIDI (sin ids; se regeneran al pegar). */
  notas?: ClipboardMidiNote[]
  /** Audio: clave de buffer / ruta. */
  sourceId?: string
  waveform?: number[]
  clipInicio?: number
}

let clips: ClipboardClip[] = []

export const dawClipboard = {
  setClips(next: ClipboardClip[]) {
    clips = next.map((c) => ({
      ...c,
      notas: c.notas?.map((n) => ({ ...n })),
      waveform: c.waveform ? [...c.waveform] : undefined,
    }))
  },
  getClips(): ClipboardClip[] {
    return clips.map((c) => ({
      ...c,
      notas: c.notas?.map((n) => ({ ...n })),
      waveform: c.waveform ? [...c.waveform] : undefined,
    }))
  },
  hasClips(): boolean {
    return clips.length > 0
  },
  clear() {
    clips = []
  },
}

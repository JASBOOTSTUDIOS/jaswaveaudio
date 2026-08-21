/**
 * Portapapeles interno del DAW (clips).
 */

export type ClipboardClip = {
  pistaOrigenId: string
  nombre: string
  inicio: number
  duracion: number
  tipo?: string
  datos?: Record<string, unknown>
}

let clips: ClipboardClip[] = []

export const dawClipboard = {
  setClips(next: ClipboardClip[]) {
    clips = next.map((c) => ({ ...c }))
  },
  getClips(): ClipboardClip[] {
    return clips.map((c) => ({ ...c }))
  },
  hasClips(): boolean {
    return clips.length > 0
  },
  clear() {
    clips = []
  },
}

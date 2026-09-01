import type { MidiSongSection } from '../midi-song-generator'

/** Densidad por tipo de sección cuando la IA no envía density. */
export function densityForSectionKind(sec: MidiSongSection): number {
  switch (sec) {
    case 'intro':
    case 'outro':
      return 0.45
    case 'verse':
      return 0.7
    case 'breakdown':
      return 0.35
    case 'build':
      return 0.85
    case 'chorus':
      return 1
    case 'bridge':
      return 0.8
    default:
      return 0.75
  }
}

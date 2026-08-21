export type Track = {
  id: string
  name: string
  /* variable CSS del color de la pista */
  color: string
  /* semilla para generar la forma de onda */
  seed: number
  /* posición del fader en dB */
  db: number
  /* balance de -100 a 100 */
  pan: number
}

export const TRACKS: Track[] = [
  { id: 'vocals', name: 'Vocals', color: 'var(--track-vocals)', seed: 7, db: 0, pan: 0 },
  { id: 'drums', name: 'Drums', color: 'var(--track-drums)', seed: 13, db: 0, pan: 0 },
  { id: 'bass', name: 'Bass', color: 'var(--track-bass)', seed: 21, db: 0, pan: 0 },
  { id: 'guitar', name: 'Guitar', color: 'var(--track-guitar)', seed: 34, db: -1.4, pan: 12 },
  { id: 'piano', name: 'Piano', color: 'var(--track-piano)', seed: 55, db: -6.3, pan: -18 },
  { id: 'fx', name: 'FX + Orchestration', color: 'var(--track-fx)', seed: 89, db: 0, pan: 0 },
]

/* Generador pseudoaleatorio determinista para dibujar formas de onda estables */
export function makeWaveform(seed: number, count: number): number[] {
  const out: number[] = []
  let s = seed * 9973
  for (let i = 0; i < count; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const base = (s / 0x7fffffff) * 0.7 + 0.15
    // envolvente suave para simular pasajes con más energía
    const env = 0.55 + 0.45 * Math.sin(i / (count / 6) + seed)
    out.push(Math.min(1, base * env))
  }
  return out
}

export const SONG_SECTIONS = ['Verse 1', 'Verse 2', 'Chorus', 'Bridge', 'Outro instrumental']

export const LYRIC_THEMES = [
  'comunión',
  'Espíritu Santo',
  'adoración',
  'pan de vida / vino del amor',
  'presencia de Dios',
]

export const STEMS = ['Vocals', 'Drums', 'Bass', 'Guitar', 'Piano', 'FX + Orchestration']

export const SUGGESTIONS = [
  'ajustar la letra para que sea más congregacional',
  'hacerla más íntima y reverente',
  'hacer el coro más pegajoso',
  'quitar la pista de voces original vacía',
  'mezclarla más tipo worship acústico',
]

/** Figuras rítmicas para el editor de partitura (duración en beats, 4/4). */

export type ScoreNoteDuration = {
  id: string
  label: string
  symbol: string
  beats: number
  snap: number
}

export const SCORE_NOTE_DURATIONS: ScoreNoteDuration[] = [
  { id: 'w', label: 'Redonda', symbol: '𝅝', beats: 4, snap: 1 },
  { id: 'h', label: 'Blanca', symbol: '𝅗𝅥', beats: 2, snap: 0.5 },
  { id: 'hd', label: 'Blanca punteada', symbol: '𝅗𝅥·', beats: 3, snap: 0.5 },
  { id: 'q', label: 'Negra', symbol: '♩', beats: 1, snap: 0.25 },
  { id: 'qd', label: 'Negra punteada', symbol: '♩·', beats: 1.5, snap: 0.25 },
  { id: '8', label: 'Corchea', symbol: '♪', beats: 0.5, snap: 0.125 },
  { id: '8d', label: 'Corchea punteada', symbol: '♪·', beats: 0.75, snap: 0.125 },
  { id: '16', label: 'Semicorchea', symbol: '𝅘𝅥𝅯', beats: 0.25, snap: 0.125 },
  { id: '32', label: 'Fusa', symbol: '𝅘𝅥𝅰', beats: 0.125, snap: 0.0625 },
]

export function durationById(id: string): ScoreNoteDuration {
  return SCORE_NOTE_DURATIONS.find((d) => d.id === id) ?? SCORE_NOTE_DURATIONS[4]!
}

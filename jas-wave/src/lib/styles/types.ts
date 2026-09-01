/**
 * Perfil de estilo musical — reglas/stats extraídas de un clip MIDI.
 * No embebe las notas crudas; sirve de prior creativo para la IA.
 */

import type { GrooveTemplate } from '@jaswave/shared'

export type StyleRole = 'drums' | 'bass' | 'keys' | 'pad' | 'lead' | 'guitar' | 'fx' | 'other'

export type StyleFeel = 'halfTime' | 'full' | 'sparse' | 'build'

export type StyleScope = 'project' | 'global'

export type StyleKitStats = {
  kick: number
  snare: number
  snareGhost: number
  hatClosed: number
  hatOpen: number
  crash: number
  ride: number
  tom: number
  other: number
  total: number
  avgVel: number
  /** Hits de kick por beat (0..3) promediados en el clip, 16 steps de 16vos. */
  kickGrid16: number[]
  /** Hits de snare (no ghost) por 16vo. */
  snareGrid16: number[]
}

export type StyleMotifContour = {
  /** Intervalos relativos entre notas sucesivas (melódicas). */
  intervals: number[]
  /** Onsets cuantizados a semicorchea relativos al inicio del clip (primeras N). */
  rhythm16: number[]
  pitchMin: number
  pitchMax: number
  notesPerBar: number
}

export type StyleSectionHint = 'sparse' | 'build' | 'dense'

export type StyleProfileSource = {
  projectId?: string
  trackId?: string
  clipId?: string
  trackName?: string
  clipName?: string
}

export type StyleProfile = {
  id: string
  nombre: string
  rol: StyleRole
  tags: string[]
  bpm: number
  feel: StyleFeel
  groove: GrooveTemplate
  stats: StyleKitStats
  motifContour: StyleMotifContour
  sectionHints: StyleSectionHint[]
  source?: StyleProfileSource
  /** Resumen legible para prompt / futuro embedding. */
  summaryText: string
  scope: StyleScope
  createdAt: number
  updatedAt: number
  version: 1
}

export type StyleCatalogFile = {
  version: 1
  profiles: StyleProfile[]
}

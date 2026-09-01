import type { InstrumentRole } from '../plugin-knowledge'
import type { Articulation, MidiSongSection } from '../midi-song-generator'

export type MusicBuildStageId =
  | 'spec'
  | 'setup'
  | 'structure'
  | 'tracks'
  | 'instruments'
  | 'midi'
  | 'mix'
  | 'validate'

export type MusicBuildStageStatus = 'pending' | 'running' | 'ok' | 'fail' | 'skip'

export type MusicBuildStage = {
  id: MusicBuildStageId
  label: string
  status: MusicBuildStageStatus
  detail?: string
}

/** Sección de forma. `degrees` / `density` los decide la IA; sin ellos el motor usa fallback. */
export type MusicSection = {
  name: string
  bars: number
  /** Grados Nashville 1–7 propios de esta sección. */
  degrees?: number[]
  /** 0–1 densidad rítmica/armónica. */
  density?: number
  /** Clasificación para el renderer (opcional; se infiere del nombre). */
  kind?: MidiSongSection
}

export type MusicBuildTrackSpec = {
  nombre: string
  rol: InstrumentRole | string
  tipo: 'midi' | 'instrumento' | 'audio'
  articulacion?: Articulation | string
  pluginNombre?: string
  pluginId?: string
  /** Preset de la biblioteca del proyecto. */
  presetId?: string
}

export type MusicBuildSpec = {
  nombre: string
  prompt: string
  bpm: number
  keyRoot: number
  scale: 'major' | 'minor'
  keyLabel: string
  minutes: number
  /** Progresión global (fallback si una sección no trae degrees). */
  degrees: number[]
  sections: MusicSection[]
  tracks: MusicBuildTrackSpec[]
  /** Género declarado por la IA (metal, salsa, ambient…). */
  genero?: string
  /** true si algún campo vino de heurística local, no de la IA. */
  usedHeuristicFallback?: boolean
}

/** Payload parcial que puede mandar la IA (español/inglés). */
export type MusicBuildAiPartial = {
  nombre?: string
  prompt?: string
  bpm?: number
  minutos?: number
  minutes?: number
  tonalidad?: string
  keyRoot?: number
  scale?: 'major' | 'minor'
  keyLabel?: string
  genero?: string
  genre?: string
  degrees?: number[]
  progresion?: number[]
  progression?: number[]
  sections?: MusicSection[]
  secciones?: Array<{
    name?: string
    nombre?: string
    bars?: number
    compases?: number
    degrees?: number[]
    progresion?: number[]
    density?: number
    densidad?: number
    kind?: string
  }>
  tracks?: MusicBuildTrackSpec[]
  pistas?: Array<{
    nombre?: string
    name?: string
    rol?: string
    tipo?: string
    articulacion?: string
    pluginNombre?: string
    pluginId?: string
    presetId?: string
  }>
}

export type MidiValidationIssue = {
  severity: 'error' | 'warn'
  track?: string
  code: string
  message: string
}

export type MusicBuildResult = {
  kind: 'musicBuild'
  spec: MusicBuildSpec
  stages: MusicBuildStage[]
  issues: MidiValidationIssue[]
  applied: boolean
  status: 'planned' | 'completed' | 'failed'
}

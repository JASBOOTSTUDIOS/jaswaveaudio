import type { InstrumentRole } from '../plugin-knowledge'
import type { Articulation } from '../midi-song-generator'

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

export type MusicSection = {
  name: string
  bars: number
}

export type MusicBuildTrackSpec = {
  nombre: string
  rol: InstrumentRole | string
  tipo: 'midi' | 'instrumento' | 'audio'
  articulacion?: Articulation | string
  pluginNombre?: string
  pluginId?: string
}

export type MusicBuildSpec = {
  nombre: string
  prompt: string
  bpm: number
  keyRoot: number
  scale: 'major' | 'minor'
  keyLabel: string
  minutes: number
  degrees: number[]
  sections: MusicSection[]
  tracks: MusicBuildTrackSpec[]
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

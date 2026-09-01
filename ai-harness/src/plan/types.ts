export type PlanTask = {
  text: string
  done: boolean
  source: string
}

export type PlanTaskKind = 'track' | 'vst' | 'bounce' | 'mix' | 'sidechain' | 'generic'

export type PlanTaskCheck = {
  task: string
  ok: boolean
  kind: PlanTaskKind
  reason: string
}

export type PlanEvaluation = {
  planned: number
  done: number
  missing: string[]
  extraTracks: string[]
  summary: string
  markdown: string
  checks: PlanTaskCheck[]
}

export type ProjectPlanTrack = {
  nombre: string
  rol: string
  tipo: 'midi' | 'instrumento' | 'audio'
  pluginNombre?: string
  pluginId?: string
  articulacion?: string
  noteMapSummary?: string
}

export type ProjectPlanData = {
  kind: 'projectPlan'
  nombre: string
  bpm: number
  keyLabel: string
  minutes: number
  pensamiento?: string
  tracks: ProjectPlanTrack[]
  status?: 'pending' | 'applied' | 'discarded'
  applied?: boolean
}

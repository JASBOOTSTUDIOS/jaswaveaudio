import type { HarnessDawAction } from '../types/actions'

export type AgentWorkPhaseType =
  | 'structure'
  | 'midi-generation'
  | 'midi-edit'
  | 'plugins'
  | 'mix'
  | 'analysis'
  | 'render'

export type AgentWorkPhaseStatus = 'pending' | 'validated' | 'executing' | 'completed' | 'failed'

export type PlannedAction = {
  id: string
  tool: string
  arguments: Record<string, unknown>
}

export type AgentWorkPhase = {
  id: string
  type: AgentWorkPhaseType
  dependsOn: string[]
  status: AgentWorkPhaseStatus
  actions: PlannedAction[]
}

export type AgentWorkPlan = {
  id: string
  objective: string
  stateVersion?: string | number
  phases: AgentWorkPhase[]
  policy: {
    requiresConfirmation: boolean
    rollback: 'atomic' | 'per-phase'
    maxCommandsPerPhase: number
  }
}

const COMPLEX = new Set(['daw.musicBuild', 'daw.composeProject', 'daw.masterPass', 'daw.generateMidiSong'])

export function shouldUseWorkPlan(actions: HarnessDawAction[]): boolean {
  if (actions.some((a) => COMPLEX.has(a.type))) return true
  const midiCreates = actions.filter((a) => a.type === 'midi.clip.create' || a.type === 'midi.notes.set').length
  return midiCreates >= 3
}

function phaseTypeFor(type: string): AgentWorkPhaseType {
  if (/^daw\.(musicBuild|composeProject)|project\.(setBpm|setTimeSignature|update)|track\.create/.test(type)) {
    return 'structure'
  }
  if (/^plugin\.|^library\.preset/.test(type)) return 'plugins'
  if (/^midi\.(humanize|quantize|applyGroove|notes\.patch|notes\.dedupe|transpose)/.test(type)) return 'midi-edit'
  if (/^midi\.|^clip\./.test(type)) return 'midi-generation'
  if (/^track\.update|^bus\.|^send\.|^sidechain|^master\.|^automation/.test(type)) return 'mix'
  if (/^analysis\./.test(type)) return 'analysis'
  if (/^render\.|^daw\.masterPass/.test(type)) return 'render'
  return 'structure'
}

const ORDER: AgentWorkPhaseType[] = [
  'structure',
  'plugins',
  'midi-generation',
  'midi-edit',
  'mix',
  'analysis',
  'render',
]

export function buildWorkPlanFromActions(
  actions: HarnessDawAction[],
  opts?: { objective?: string; stateVersion?: string | number },
): AgentWorkPlan {
  const buckets = new Map<AgentWorkPhaseType, PlannedAction[]>()
  actions.forEach((a, i) => {
    const kind = phaseTypeFor(a.type)
    const list = buckets.get(kind) ?? []
    list.push({
      id: `a${i}`,
      tool: a.type,
      arguments: (a.payload ?? {}) as Record<string, unknown>,
    })
    buckets.set(kind, list)
  })
  const phases: AgentWorkPhase[] = []
  let prev: string | undefined
  for (const type of ORDER) {
    const acts = buckets.get(type)
    if (!acts?.length) continue
    const id = `ph-${type}`
    phases.push({
      id,
      type,
      dependsOn: prev ? [prev] : [],
      status: 'pending',
      actions: acts,
    })
    prev = id
  }
  return {
    id: `wp-${Date.now()}`,
    objective: opts?.objective ?? 'Operación compleja',
    stateVersion: opts?.stateVersion,
    phases,
    policy: {
      requiresConfirmation: true,
      rollback: 'per-phase',
      maxCommandsPerPhase: 24,
    },
  }
}

export function projectStateFingerprint(state: {
  checksum?: string
  project?: { bpm?: { valor?: number }; tracks?: Array<{ id: string; clips?: unknown[] }> }
}): string {
  if (state.checksum && state.checksum.length > 0) return state.checksum
  const tracks = state.project?.tracks ?? []
  const bits = tracks.map((t) => `${t.id}:${(t.clips ?? []).length}`).join(',')
  return `${state.project?.bpm?.valor ?? 0}|${bits}`
}

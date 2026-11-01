import { EventosIAExt, type DAWState } from '@jaswave/shared'
import type { HarnessActionResult, HarnessDawAction } from '../types/actions'
import {
  type AgentWorkPlan,
  type AgentWorkPhase,
  projectStateFingerprint,
} from '../planning/agent-work-plan'
import { evaluateMidiQuality } from '../quality/midi-quality-gate'
import { evaluateArrangementQuality } from '../quality/arrangement-quality-gate'

export type AgentWorkPlanEventName =
  | typeof EventosIAExt.planCreado
  | typeof EventosIAExt.faseIniciada
  | typeof EventosIAExt.faseCompletada
  | typeof EventosIAExt.faseFallida
  | typeof EventosIAExt.planCompletado
  | typeof EventosIAExt.planFallido

export type AgentWorkPlanRunResult = {
  plan: AgentWorkPlan
  results: HarnessActionResult[]
  stoppedReason: 'completed' | 'phase-failed' | 'state-conflict' | 'aborted' | 'max-commands'
}

export type RunAgentWorkPlanOpts = {
  plan: AgentWorkPlan
  execute: (actions: HarnessDawAction[]) => Promise<HarnessActionResult[]>
  getState: () => DAWState
  abort?: AbortSignal
  onEvent?: (name: AgentWorkPlanEventName, payload: Record<string, unknown>) => void
}

function plannedToActions(phase: AgentWorkPhase, max: number): HarnessDawAction[] {
  return phase.actions.slice(0, max).map((a) => ({
    type: a.tool,
    payload: a.arguments,
  }))
}

export async function runAgentWorkPlan(opts: RunAgentWorkPlanOpts): Promise<AgentWorkPlanRunResult> {
  const plan = opts.plan
  const results: HarnessActionResult[] = []
  opts.onEvent?.(EventosIAExt.planCreado, { planId: plan.id, phases: plan.phases.length })
  let lastSeenFp = plan.stateVersion != null ? String(plan.stateVersion) : projectStateFingerprint(opts.getState())

  for (const phase of plan.phases) {
    if (opts.abort?.aborted) {
      opts.onEvent?.(EventosIAExt.planFallido, { planId: plan.id, reason: 'aborted' })
      return { plan, results, stoppedReason: 'aborted' }
    }
    const nowFp = projectStateFingerprint(opts.getState())
    if (nowFp !== lastSeenFp) {
      phase.status = 'failed'
      opts.onEvent?.(EventosIAExt.faseFallida, { planId: plan.id, phaseId: phase.id, reason: 'state-conflict' })
      opts.onEvent?.(EventosIAExt.planFallido, { planId: plan.id, reason: 'state-conflict' })
      return { plan, results, stoppedReason: 'state-conflict' }
    }
    const batch = plannedToActions(phase, plan.policy.maxCommandsPerPhase)
    if (phase.actions.length > plan.policy.maxCommandsPerPhase) {
      phase.status = 'failed'
      opts.onEvent?.(EventosIAExt.faseFallida, { planId: plan.id, phaseId: phase.id, reason: 'max-commands' })
      return { plan, results, stoppedReason: 'max-commands' }
    }
    phase.status = 'executing'
    opts.onEvent?.(EventosIAExt.faseIniciada, { planId: plan.id, phaseId: phase.id, type: phase.type })
    const turn = batch.length ? await opts.execute(batch) : []
    results.push(...turn)
    const failed = turn.some((r) => !r.success)
    if (failed) {
      phase.status = 'failed'
      opts.onEvent?.(EventosIAExt.faseFallida, { planId: plan.id, phaseId: phase.id })
      opts.onEvent?.(EventosIAExt.planFallido, { planId: plan.id, phaseId: phase.id })
      return { plan, results, stoppedReason: 'phase-failed' }
    }
    const st = opts.getState()
    if (phase.type === 'midi-generation' || phase.type === 'midi-edit') {
      const midi = evaluateMidiQuality({ state: st, mutatedMidi: true })
      const arr = evaluateArrangementQuality(st)
      if (midi.verdict === 'fail' || arr.verdict === 'fail') {
        phase.status = 'failed'
        const msg = [...midi.findings, ...arr.findings]
          .filter((f) => f.verdict === 'fail')
          .map((f) => f.message)
          .join('; ')
        opts.onEvent?.(EventosIAExt.faseFallida, { planId: plan.id, phaseId: phase.id, quality: msg })
        return { plan, results, stoppedReason: 'phase-failed' }
      }
    }
    lastSeenFp = projectStateFingerprint(opts.getState())
    phase.status = 'completed'
    opts.onEvent?.(EventosIAExt.faseCompletada, { planId: plan.id, phaseId: phase.id })
  }

  opts.onEvent?.(EventosIAExt.planCompletado, { planId: plan.id })
  return { plan, results, stoppedReason: 'completed' }
}

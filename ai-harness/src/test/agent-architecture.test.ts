import { describe, it, expect } from 'vitest'
import { parseActionsFromText } from '../recovery/legacy-actions-parser'
import {
  legacyActionsToToolCalls,
  toolCallsToLegacyActions,
  filterUnknownTools,
} from '../compatibility/legacy-actions-adapter'
import {
  deterministicFallbacksFromUserIntent,
  isCreativeGenerationRequest,
} from '../recovery/deterministic-fallbacks'
import {
  shouldUseWorkPlan,
  buildWorkPlanFromActions,
  projectStateFingerprint,
} from '../planning/agent-work-plan'
import { runAgentWorkPlan } from '../execution/plan-runner'
import { composeAgentPrompt } from '../prompting/compose-agent-prompt'
import { composeAgentTurnContext } from '../context/compose-agent-context'
import type { DAWState } from '@jaswave/shared'
import type { HarnessActionResult } from '../types/actions'

describe('legacy ACTIONS parser', () => {
  it('parsea ACTIONS válidas', () => {
    const raw = `ok\n<<<ACTIONS\n[{"type":"project.setBpm","payload":{"bpm":120}}]\nACTIONS>>>`
    const a = parseActionsFromText(raw)
    expect(a).toEqual([{ type: 'project.setBpm', payload: { bpm: 120 } }])
  })

  it('JSON inválido → []', () => {
    expect(parseActionsFromText('<<<ACTIONS\n{nope}\nACTIONS>>>')).toEqual([])
  })
})

describe('legacy adapter', () => {
  it('round-trip DawAction ↔ ToolCall', () => {
    const actions = [{ type: 'project.setBpm', payload: { bpm: 96 } }]
    const calls = legacyActionsToToolCalls(actions)
    expect(calls[0]).toEqual({ tool: 'project.setBpm', arguments: { bpm: 96 } })
    expect(toolCallsToLegacyActions(calls)).toEqual(actions)
  })

  it('hoists flat fields (bpm/pistaId en raíz)', () => {
    const calls = legacyActionsToToolCalls([
      { type: 'project.setBpm', bpm: 125 } as { type: string; bpm: number },
      { type: 'clip.delete', pistaId: 't1', clipId: 'c9' } as {
        type: string
        pistaId: string
        clipId: string
      },
    ])
    expect(calls[0]?.arguments).toEqual({ bpm: 125 })
    expect(calls[1]?.arguments).toEqual({ pistaId: 't1', clipId: 'c9' })
  })

  it('separa tools desconocidas', () => {
    const { known, unknown } = filterUnknownTools(
      [
        { type: 'project.setBpm', payload: {} },
        { type: 'no.existe', payload: {} },
      ],
      ['project.setBpm'],
    )
    expect(known.map((a) => a.type)).toEqual(['project.setBpm'])
    expect(unknown.map((a) => a.type)).toEqual(['no.existe'])
  })
})

describe('deterministic fallbacks', () => {
  it('pon BPM a 120 → project.setBpm', () => {
    const a = deterministicFallbacksFromUserIntent({ userText: 'pon BPM a 120' })
    expect(a.some((x) => x.type === 'project.setBpm' && x.payload?.bpm === 120)).toBe(true)
  })

  it('créame una canción synthwave no es fallback creativo aquí', () => {
    expect(isCreativeGenerationRequest('créame una canción synthwave')).toBe(true)
    const a = deterministicFallbacksFromUserIntent({ userText: 'créame una canción synthwave' })
    expect(a.some((x) => x.type === 'daw.musicBuild' || x.type === 'daw.generateMidiSong')).toBe(false)
  })
})

describe('prompt composer', () => {
  it('compone contexto + modo sin lista hardcodeada de 80 acciones', () => {
    const state = { project: { tracks: [], bpm: { valor: 100 } } } as unknown as DAWState
    const ctx = composeAgentTurnContext({ state, docsText: 'docs' })
    const prompt = composeAgentPrompt({ context: ctx, modeBlock: '## Modo: CREACIÓN', toolsFragment: '- project.setBpm' })
    expect(prompt).toContain('Herramientas (Tool Registry)')
    expect(prompt).toContain('project.setBpm')
    expect(prompt).not.toContain('daw.generateMidiSong { aplicar, prompt?')
  })
})

describe('AgentWorkPlan', () => {
  it('agrupa fases y respeta dependencias', () => {
    const plan = buildWorkPlanFromActions(
      [
        { type: 'daw.musicBuild', payload: {} },
        { type: 'midi.clip.create', payload: {} },
        { type: 'midi.clip.create', payload: {} },
        { type: 'midi.clip.create', payload: {} },
        { type: 'track.update', payload: {} },
      ],
      { objective: 'canción', stateVersion: 'v1' },
    )
    expect(shouldUseWorkPlan(plan.phases.flatMap((p) => p.actions.map((a) => ({ type: a.tool }))))).toBe(true)
    expect(plan.phases[0]?.type).toBe('structure')
    const midi = plan.phases.find((p) => p.type === 'midi-generation')
    expect(midi?.dependsOn.length).toBeGreaterThan(0)
  })

  it('runner: fallo de fase y cancelación', async () => {
    const plan = buildWorkPlanFromActions([{ type: 'project.setBpm', payload: { bpm: 72 } }], {
      stateVersion: 'ok',
    })
    const fail = await runAgentWorkPlan({
      plan: structuredClone(plan),
      execute: async () => [{ type: 'project.setBpm', success: false, message: 'no' }],
      getState: () => ({ checksum: 'ok', project: { tracks: [] } }) as unknown as DAWState,
    })
    expect(fail.stoppedReason).toBe('phase-failed')

    const ac = new AbortController()
    ac.abort()
    const aborted = await runAgentWorkPlan({
      plan: structuredClone(plan),
      execute: async () => [],
      getState: () => ({ checksum: 'ok', project: { tracks: [] } }) as unknown as DAWState,
      abort: ac.signal,
    })
    expect(aborted.stoppedReason).toBe('aborted')
  })

  it('conflicto de estado al inicio de una fase', async () => {
    const plan = buildWorkPlanFromActions([{ type: 'project.setBpm', payload: { bpm: 72 } }], {
      stateVersion: 'expected',
    })
    const out = await runAgentWorkPlan({
      plan,
      execute: async () => [{ type: 'project.setBpm', success: true, message: 'ok' }],
      getState: () => ({ checksum: 'other', project: { tracks: [] } }) as unknown as DAWState,
    })
    expect(out.stoppedReason).toBe('state-conflict')
  })

  it('límite maxCommandsPerPhase', async () => {
    const plan = buildWorkPlanFromActions([{ type: 'project.setBpm', payload: {} }])
    plan.policy.maxCommandsPerPhase = 0
    const out = await runAgentWorkPlan({
      plan,
      execute: async () => [],
      getState: () => ({ checksum: projectStateFingerprint({ checksum: 'x' }), project: { tracks: [] } }) as unknown as DAWState,
    })
    expect(out.stoppedReason).toBe('max-commands')
  })

  it('emite eventos de plan/fase', async () => {
    const names: string[] = []
    const plan = buildWorkPlanFromActions([{ type: 'project.setBpm', payload: { bpm: 90 } }], {
      stateVersion: 'ok',
    })
    await runAgentWorkPlan({
      plan,
      execute: async () => [{ type: 'project.setBpm', success: true, message: 'ok' }],
      getState: () => ({ checksum: 'ok', project: { tracks: [] } }) as unknown as DAWState,
      onEvent: (name) => names.push(name),
    })
    expect(names).toEqual(['ia.planCreado', 'ia.faseIniciada', 'ia.faseCompletada', 'ia.planCompletado'])
  })
})

import { describe, it, expect } from 'vitest'
import { runAgentLoop } from '../loop/agent-loop'
import { parseAgentDecisionFromText } from '../recovery/parse-agent-decision'
import { observeAgentContext } from '../context/agent-observer'
import { validateAgentToolCalls } from '../loop/validate-tool-calls'
import { buildWorkPlanFromActions } from '../planning/agent-work-plan'
import { runAgentWorkPlan } from '../execution/plan-runner'
import type { DAWState } from '@jaswave/shared'
import type { AgentLoopToolCall, AgentLoopToolResult } from '../loop/agent-run-types'

function state(over: Partial<DAWState['project']> & { checksum?: string } = {}): DAWState {
  return {
    checksum: over.checksum ?? 'rev-1',
    project: {
      tracks: [
        { id: 'bass_01', nombre: 'Bajo', tipo: 'midi', clips: [] },
      ],
      bpm: { valor: 120 },
      ...(over as object),
    },
    selection: { idsPistas: ['bass_01'], idsClips: [], idPrincipal: 'bass_01' },
  } as unknown as DAWState
}

function dec(obj: unknown): string {
  return `<<<DECISION\n${JSON.stringify(obj)}\nDECISION>>>`
}

describe('parseAgentDecisionFromText', () => {
  it('DECISION tool-calls', () => {
    const d = parseAgentDecisionFromText(dec({ type: 'tool-calls', calls: [{ tool: 'project.setBpm', arguments: { bpm: 120 } }] }))
    expect(d?.type).toBe('tool-calls')
    if (d?.type === 'tool-calls') expect(d.calls[0]?.tool).toBe('project.setBpm')
  })

  it('ACTIONS legacy → tool-calls', () => {
    const d = parseAgentDecisionFromText('<<<ACTIONS\n[{"type":"project.setBpm","payload":{"bpm":120}}]\nACTIONS>>>')
    expect(d?.type).toBe('tool-calls')
  })

  it('CLARIFY → request-user-input', () => {
    const d = parseAgentDecisionFromText('<<<CLARIFY[{"id":"q1","question":"¿BPM?"}]\nCLARIFY>>>')
    expect(d?.type).toBe('request-user-input')
  })

  it('ACTIONS sin cierre → tool-calls', () => {
    const d = parseAgentDecisionFromText(
      'ok\n<<<ACTIONS\n[{"type":"daw.musicBuild","payload":{"aplicar":true,"prompt":"bachata"}}]\n',
    )
    expect(d?.type).toBe('tool-calls')
    if (d?.type === 'tool-calls') expect(d.calls[0]?.tool).toBe('daw.musicBuild')
  })

  it('ACTIONS flat (bpm en raíz) conserva argumentos', () => {
    const d = parseAgentDecisionFromText(
      '<<<ACTIONS\n[{"type":"project.setBpm","bpm":125},{"type":"clip.delete","pistaId":"t1","clipId":"c1"}]\nACTIONS>>>',
    )
    expect(d?.type).toBe('tool-calls')
    if (d?.type === 'tool-calls') {
      expect(d.calls[0]?.arguments).toEqual({ bpm: 125 })
      expect(d.calls[1]?.arguments).toEqual({ pistaId: 't1', clipId: 'c1' })
    }
  })

  it('JSON tool-calls sin marcadores', () => {
    const d = parseAgentDecisionFromText(
      'Voy a ejecutar:\n{"type":"tool-calls","calls":[{"tool":"project.setBpm","arguments":{"bpm":125}}]}\n',
    )
    expect(d?.type).toBe('tool-calls')
  })
})

describe('runAgentLoop', () => {
  const known = ['project.setBpm', 'selection.get', 'track.toggleMute', 'daw.musicBuild']

  it('observe → tool → result → complete', async () => {
    let n = 0
    const st = state()
    const out = await runAgentLoop({
      userText: 'pon BPM a 120',
      knownTools: known,
      getState: () => st,
      observe: (last) => observeAgentContext({ state: st, userText: 'pon BPM a 120', lastResults: last }),
      chat: async () => {
        n += 1
        if (n === 1) {
          return dec({ type: 'tool-calls', calls: [{ id: 'c1', tool: 'project.setBpm', arguments: { bpm: 120 } }] })
        }
        return dec({ type: 'complete', summary: 'BPM a 120' })
      },
      executeCalls: async (calls) =>
        calls.map((c) => ({ callId: c.id, tool: c.tool, status: 'success' as const, stateRevision: 'rev-1' })),
    })
    expect(out.status).toBe('completed')
    expect(out.results.some((r) => r.tool === 'project.setBpm')).toBe(true)
    expect(n).toBe(2)
  })

  it('reintenta una vez si la 1ª respuesta es solo prosa', async () => {
    let n = 0
    const st = state()
    const out = await runAgentLoop({
      userText: 'limpia y arma bachata',
      knownTools: known,
      priorBrief: 'Usar daw.musicBuild a 125 BPM',
      getState: () => st,
      observe: (last) =>
        observeAgentContext({ state: st, userText: 'limpia y arma bachata', lastResults: last }),
      chat: async () => {
        n += 1
        if (n === 1) {
          return '1/6 · Traducir pedido\nVoy a limpiar y hacer bachata sin emitir protocolo.'
        }
        if (n === 2) {
          return dec({
            type: 'tool-calls',
            calls: [{ id: 'c1', tool: 'daw.musicBuild', arguments: { aplicar: true, prompt: 'bachata' } }],
          })
        }
        return dec({ type: 'complete', summary: 'listo' })
      },
      executeCalls: async (calls) =>
        calls.map((c) => ({ callId: c.id, tool: c.tool, status: 'success' as const, stateRevision: 'rev-1' })),
      requireConfirmationForWrites: false,
    })
    expect(out.status).toBe('completed')
    expect(n).toBeGreaterThanOrEqual(2)
    expect(out.results.some((r) => r.tool === 'daw.musicBuild')).toBe(true)
  })

  it('read before write: selection.get luego mute con ID real', async () => {
    const st = state()
    const script = [
      dec({ type: 'tool-calls', calls: [{ id: 'r1', tool: 'selection.get', arguments: {} }] }),
      dec({
        type: 'tool-calls',
        calls: [{ id: 'w1', tool: 'track.toggleMute', arguments: { trackId: 'bass_01' } }],
      }),
      dec({ type: 'complete', summary: 'Mute aplicado' }),
    ]
    let i = 0
    const executed: string[] = []
    const out = await runAgentLoop({
      userText: 'silencia la pista seleccionada',
      knownTools: known,
      getState: () => st,
      observe: (last) => observeAgentContext({ state: st, userText: 'silencia la pista seleccionada', lastResults: last }),
      chat: async () => script[i++] ?? dec({ type: 'complete', summary: 'ok' }),
      executeCalls: async (calls) => {
        executed.push(...calls.map((c) => c.tool))
        return calls.map((c) => ({
          callId: c.id,
          tool: c.tool,
          status: 'success' as const,
          data: c.tool === 'selection.get' ? { trackId: 'bass_01' } : undefined,
        }))
      },
    })
    expect(executed[0]).toBe('selection.get')
    expect(executed).toContain('track.toggleMute')
    expect(out.status).toBe('completed')
  })

  it('tool fail → fail o replan', async () => {
    let n = 0
    const st = state()
    const out = await runAgentLoop({
      userText: 'bpm',
      knownTools: known,
      getState: () => st,
      observe: () => observeAgentContext({ state: st, userText: 'bpm' }),
      chat: async () => {
        n += 1
        if (n === 1) return dec({ type: 'tool-calls', calls: [{ tool: 'project.setBpm', arguments: { bpm: 90 } }] })
        return dec({ type: 'fail', reason: 'no se pudo' })
      },
      executeCalls: async (calls) =>
        calls.map((c) => ({
          callId: c.id,
          tool: c.tool,
          status: 'error' as const,
          error: { code: 'X', message: 'boom' },
        })),
    })
    expect(out.status).toBe('failed')
  })

  it('fingerprint conflict se reobserva (el modelo puede replanificar)', async () => {
    let fp = 'a'
    const st = () => state({ checksum: fp } as never)
    let n = 0
    const out = await runAgentLoop({
      userText: 'x',
      knownTools: known,
      getState: () => st(),
      observe: (last) => {
        const s = st()
        return observeAgentContext({ state: s, userText: 'x', lastResults: last })
      },
      chat: async (_p, obs) => {
        n += 1
        if (n === 1) {
          fp = 'b'
          return dec({ type: 'tool-calls', calls: [{ tool: 'project.setBpm', arguments: { bpm: 100 } }] })
        }
        if (obs.fingerprint === 'b') return dec({ type: 'replan', reason: 'estado cambió' })
        return dec({ type: 'complete', summary: 'ok' })
      },
      executeCalls: async (calls) => {
        fp = 'b'
        return calls.map((c) => ({ callId: c.id, tool: c.tool, status: 'success' as const, stateRevision: fp }))
      },
    })
    expect(out.status === 'completed' || out.status === 'failed').toBe(true)
    expect(n).toBeGreaterThan(1)
  })

  it('waiting-for-confirmation y resume ejecuta pending', async () => {
    const st = state()
    const paused = await runAgentLoop({
      userText: 'borra la pista',
      knownTools: known.concat(['track.delete']),
      getState: () => st,
      requireConfirmationForWrites: true,
      observe: () => observeAgentContext({ state: st, userText: 'borra' }),
      chat: async () =>
        dec({
          type: 'tool-calls',
          calls: [{ id: 'd1', tool: 'track.delete', arguments: { trackId: 'bass_01' } }],
        }),
      executeCalls: async () => [],
    })
    expect(paused.status).toBe('waiting-for-confirmation')
    expect(paused.pendingCalls?.[0]?.tool).toBe('track.delete')

    const resumed = await runAgentLoop({
      userText: 'borra la pista',
      knownTools: known.concat(['track.delete']),
      getState: () => st,
      observe: (last) => observeAgentContext({ state: st, userText: 'borra', lastResults: last }),
      chat: async () => dec({ type: 'complete', summary: 'borrado' }),
      executeCalls: async (calls) =>
        calls.map((c) => ({ callId: c.id, tool: c.tool, status: 'success' as const })),
      resume: {
        pendingCalls: paused.pendingCalls ?? [],
        results: paused.results,
        iterations: paused.iterations,
        fingerprint: 'rev-1',
        decisions: paused.decisions,
      },
    })
    expect(resumed.status).toBe('completed')
    expect(resumed.results.some((r) => r.tool === 'track.delete')).toBe(true)
  })

  it('cancelación', async () => {
    const ac = new AbortController()
    ac.abort()
    const st = state()
    const out = await runAgentLoop({
      userText: 'x',
      knownTools: known,
      getState: () => st,
      abort: ac.signal,
      observe: () => observeAgentContext({ state: st, userText: 'x' }),
      chat: async () => dec({ type: 'complete', summary: 'no' }),
      executeCalls: async () => [],
    })
    expect(out.status).toBe('cancelled')
  })

  it('trackId inventado se rechaza', async () => {
    const st = state()
    const v = validateAgentToolCalls(
      [{ id: 'c1', tool: 'track.toggleMute', arguments: { trackId: 'nope' } }],
      { knownTools: known, state: st, maxPerIteration: 4 },
    )
    expect(v.rejected[0]?.reason).toMatch(/trackId desconocido/)
  })

  it('track.update sin trackId se rechaza', () => {
    const st = state()
    const v = validateAgentToolCalls(
      [{ id: 'c1', tool: 'track.update', arguments: { nombre: 'Keys' } }],
      { knownTools: known.concat(['track.update']), state: st, maxPerIteration: 4 },
    )
    expect(v.rejected[0]?.reason).toMatch(/Falta trackId/)
  })

  it('clip.delete / setBpm / clip.create vacíos se rechazan', () => {
    const st = state()
    const tools = known.concat(['clip.delete', 'midi.clip.create'])
    const v = validateAgentToolCalls(
      [
        { id: 'c1', tool: 'clip.delete', arguments: {} },
        { id: 'c2', tool: 'project.setBpm', arguments: {} },
        { id: 'c3', tool: 'midi.clip.create', arguments: { pistaId: 'bass_01', notas: [] } },
      ],
      { knownTools: tools, state: st, maxPerIteration: 8 },
    )
    expect(v.accepted).toHaveLength(0)
    expect(v.rejected.some((r) => r.tool === 'clip.delete')).toBe(true)
    expect(v.rejected.some((r) => r.tool === 'project.setBpm')).toBe(true)
    expect(v.rejected.some((r) => r.tool === 'midi.clip.create')).toBe(true)
  })

  it('midi.clip.create con trackId se normaliza a pistaId y elimina trackId', () => {
    const st = state()
    const v = validateAgentToolCalls(
      [
        {
          id: 'c1',
          tool: 'midi.clip.create',
          arguments: {
            trackId: 'bass_01',
            inicio: 0,
            duracion: 4,
            notas: [{ pitch: 36, inicio: 0, duracion: 1 }],
          },
        },
      ],
      { knownTools: known.concat(['midi.clip.create']), state: st, maxPerIteration: 4 },
    )
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]?.arguments.pistaId).toBe('bass_01')
    expect(v.accepted[0]?.arguments.trackId).toBeUndefined()
  })

  it('toggleMute con pistaId se acepta y normaliza trackId', () => {
    const st = state()
    const v = validateAgentToolCalls(
      [{ id: 'c1', tool: 'track.toggleMute', arguments: { pistaId: 'bass_01' } }],
      { knownTools: known, state: st, maxPerIteration: 4 },
    )
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]?.arguments.trackId).toBe('bass_01')
  })

  it('solo acepta 1 clip.delete por lote', () => {
    const st = state({
      tracks: [
        {
          id: 'bass_01',
          nombre: 'Bajo',
          tipo: 'midi',
          clips: [
            { id: 'c1', inicio: 0, duracion: 4, notas: [] },
            { id: 'c2', inicio: 4, duracion: 4, notas: [] },
          ],
        } as never,
      ],
    })
    const v = validateAgentToolCalls(
      [
        { id: 'a', tool: 'clip.delete', arguments: { pistaId: 'bass_01', clipId: 'c1' } },
        { id: 'b', tool: 'clip.delete', arguments: { pistaId: 'bass_01', clipId: 'c2' } },
      ],
      { knownTools: known.concat(['clip.delete']), state: st, maxPerIteration: 4 },
    )
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]?.arguments.clipId).toBe('c1')
    expect(v.rejected).toHaveLength(1)
    expect(v.rejected[0]?.reason).toMatch(/1 mutación por iteración/)
  })

  it('rechaza setBpm + musicBuild en el mismo lote', () => {
    const st = state()
    const v = validateAgentToolCalls(
      [
        { id: 'a', tool: 'project.setBpm', arguments: { bpm: 125 } },
        { id: 'b', tool: 'daw.musicBuild', arguments: { aplicar: true, prompt: 'bachata' } },
      ],
      { knownTools: known, state: st, maxPerIteration: 4 },
    )
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]?.tool).toBe('project.setBpm')
    expect(v.rejected.some((r) => r.tool === 'daw.musicBuild')).toBe(true)
  })

  it('resuelve pistaId de clip.delete solo con clipId', () => {
    const st = state({
      tracks: [
        {
          id: 'bass_01',
          nombre: 'Bajo',
          tipo: 'midi',
          clips: [{ id: 'clip-xyz', inicio: 0, duracion: 4, notas: [] }],
        } as never,
      ],
    })
    const v = validateAgentToolCalls(
      [{ id: 'a', tool: 'clip.delete', arguments: { clipId: 'clip-xyz' } }],
      { knownTools: known.concat(['clip.delete']), state: st, maxPerIteration: 4 },
    )
    expect(v.accepted).toHaveLength(1)
    expect(v.accepted[0]?.arguments.pistaId).toBe('bass_01')
  })

  it('no permite complete si hay tools fallidas', async () => {
    let n = 0
    const st = state()
    const out = await runAgentLoop({
      userText: 'mutea el bajo',
      knownTools: known,
      getState: () => st,
      requireConfirmationForWrites: false,
      observe: (last) => observeAgentContext({ state: st, userText: 'mutea', lastResults: last }),
      chat: async () => {
        n += 1
        if (n === 1) {
          return dec({
            type: 'tool-calls',
            calls: [{ id: 'c1', tool: 'track.toggleMute', arguments: { trackId: 'bass_01' } }],
          })
        }
        // Intenta cerrar sin corregir el fallo
        return dec({ type: 'complete', summary: 'listo' })
      },
      executeCalls: async (calls) =>
        calls.map((c) => ({
          callId: c.id,
          tool: c.tool,
          status: 'error' as const,
          error: { code: 'X', message: 'boom' },
        })),
      limits: { maxIterations: 4, maxToolCallsPerIteration: 4, maxTotalToolCalls: 16 },
    })
    expect(out.status).not.toBe('completed')
    expect(out.decisions.some((d) => d.type === 'replan')).toBe(true)
  })

  it('tope de iteraciones', async () => {
    const st = state()
    const out = await runAgentLoop({
      userText: 'x',
      knownTools: known,
      getState: () => st,
      limits: { maxIterations: 2, maxToolCallsPerIteration: 4, maxTotalToolCalls: 32 },
      observe: () => observeAgentContext({ state: st, userText: 'x' }),
      chat: async () => dec({ type: 'tool-calls', calls: [{ tool: 'selection.get', arguments: {} }] }),
      executeCalls: async (calls: AgentLoopToolCall[]): Promise<AgentLoopToolResult[]> =>
        calls.map((c) => ({ callId: c.id, tool: c.tool, status: 'success' })),
    })
    expect(out.status).toBe('failed')
    expect(out.summary).toMatch(/límite de iteraciones/i)
  })
})

describe('AgentWorkPlan + loop: fase 2 no corre si fase 1 falla', () => {
  it('plan-runner para en phase-failed', async () => {
    const plan = buildWorkPlanFromActions([
      { type: 'project.setBpm', payload: { bpm: 100 } },
      { type: 'midi.clip.create', payload: {} },
      { type: 'midi.clip.create', payload: {} },
      { type: 'midi.clip.create', payload: {} },
    ])
    const out = await runAgentWorkPlan({
      plan,
      execute: async (acts) => {
        if (acts.some((a) => a.type === 'project.setBpm')) {
          return [{ type: 'project.setBpm', success: false, message: 'no' }]
        }
        throw new Error('no debía ejecutar fase MIDI')
      },
      getState: () => ({ checksum: String(plan.stateVersion ?? 'x'), project: { tracks: [] } }) as unknown as DAWState,
    })
    expect(out.stoppedReason).toBe('phase-failed')
  })
})

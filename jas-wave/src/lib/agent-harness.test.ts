import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  actionFingerprint,
  filterRedundantRepairActions,
  formatHarnessStopLine,
  harnessReviewNeeded,
  harnessShouldRepair,
  healthSignature,
  inspectDawHealth,
  runHarnessFollowups,
  seedAttemptedFingerprints,
} from './agent-harness'
import type { ActionResult } from './ai-daw-agent'
import type { DAWState } from '../../../shared/src/types/state'

function midiState(opts: { nombre: string; notes: number; tipo?: 'midi' | 'audio' }): DAWState {
  const notas = Array.from({ length: opts.notes }, (_, i) => ({ pitch: 60, inicio: i, duracion: 0.5 }))
  return {
    project: {
      tracks: [
        {
          id: 't1',
          nombre: opts.nombre,
          tipo: opts.tipo ?? 'midi',
          plugins: [],
          clips: opts.notes
            ? [{ id: 'c1', nombre: 'Clip', notas }]
            : [{ id: 'c1', nombre: 'Clip', notas: [] }],
        },
      ],
    },
  } as unknown as DAWState
}

describe('agent-harness producción', () => {
  it('no repara si el DAW está sano', () => {
    const results: ActionResult[] = [{ type: 'track.create', success: true, message: 'ok' }]
    const report = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), results, null)
    assert.equal(report.ok, true)
    assert.equal(harnessShouldRepair(report), false)
  })

  it('marca acciones fallidas y MIDI vacío tras generar', () => {
    const results: ActionResult[] = [
      { type: 'midi.clip.create', success: true, message: 'clip' },
      { type: 'plugin.insert', success: false, message: 'VST no carga' },
    ]
    const report = inspectDawHealth(midiState({ nombre: 'Lead', notes: 0 }), results, null)
    assert.equal(harnessShouldRepair(report), true)
    assert.ok(report.errors.some((e) => e.code === 'action-failed'))
    assert.ok(report.errors.some((e) => e.code === 'empty-midi'))
  })

  it('marca instrumento faltante tras un musicBuild y plugins en error', () => {
    const built: ActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
    const bare = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), built, null)
    assert.ok(bare.errors.some((e) => e.code === 'missing-instrument'))
    const crashed = midiState({ nombre: 'Lead', notes: 4 })
    crashed.project!.tracks[0]!.plugins = [
      { nombre: 'Analog Lab', estado: 'error' } as never,
    ]
    const err = inspectDawHealth(crashed, built, null)
    assert.ok(err.errors.some((e) => e.code === 'plugin-error'))
  })

  it('omite recrear un musicBuild que ya aplicó', () => {
    const prev: ActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
    const filtered = filterRedundantRepairActions(
      [
        { type: 'daw.musicBuild', payload: { aplicar: true, prompt: 'otra vez' } },
        { type: 'midi.clip.create', payload: { pistaId: 't1' } },
      ],
      prev,
    )
    assert.equal(filtered.some((a) => a.type === 'daw.musicBuild'), false)
    assert.equal(filtered[0]?.type, 'midi.clip.create')
  })

  it('no reintenta el mismo plugin.insert que ya se intentó', () => {
    const attempted = seedAttemptedFingerprints([
      { type: 'plugin.insert', success: false, message: 'Plugin «Analog Lab» no carga' },
    ])
    const filtered = filterRedundantRepairActions(
      [
        { type: 'plugin.insert', payload: { nombre: 'Analog Lab' } },
        { type: 'plugin.insert', payload: { nombre: 'JasWave Soft Pad' } },
      ],
      [],
      attempted,
    )
    assert.equal(filtered.some((a) => String(a.payload?.nombre).includes('Analog')), false)
    assert.equal(filtered[0]?.payload?.nombre, 'JasWave Soft Pad')
  })

  it('fingerprint distingue pistas', () => {
    assert.notEqual(
      actionFingerprint('track.create', { nombre: 'Bajo' }),
      actionFingerprint('track.create', { nombre: 'Pad' }),
    )
  })

  it('para el bucle si la firma de error no cambia', async () => {
    const broken: ActionResult[] = [{ type: 'plugin.insert', success: false, message: 'boom' }]
    let chats = 0
    const out = await runHarnessFollowups({
      userText: 'pon analog lab',
      initialResults: broken,
      evaluation: null,
      actionsSummary: '✗ boom',
      projectId: 'p1',
      maxRepairTurns: 3,
      chat: async () => {
        chats += 1
        return { success: true, content: 'no pude\n<<<ACTIONS\n[]\nACTIONS>>>' }
      },
      parseActions: () => [{ type: 'plugin.insert', payload: { nombre: 'Analog Lab' } }],
      execute: async () => [{ type: 'plugin.insert', success: false, message: 'boom' }],
      getState: () => midiState({ nombre: 'X', notes: 4 }),
      formatResults: (r) => r.map((x) => x.message).join('\n'),
    })
    assert.equal(out.stoppedReason, 'no-progress')
    assert.equal(chats, 1)
  })

  it('para si el modelo no emite acciones nuevas', async () => {
    const out = await runHarnessFollowups({
      userText: 'arregla el vst',
      initialResults: [{ type: 'plugin.insert', success: false, message: 'boom' }],
      evaluation: null,
      actionsSummary: '✗ boom',
      projectId: 'p1',
      maxRepairTurns: 3,
      chat: async () => ({ success: true, content: 'no puedo sin que elijas el VST\n<<<ACTIONS\n[]\nACTIONS>>>' }),
      parseActions: () => [],
      execute: async () => [],
      getState: () => midiState({ nombre: 'X', notes: 4 }),
      formatResults: () => '',
    })
    assert.equal(out.stoppedReason, 'no-progress')
    assert.equal(out.turns.length, 1)
  })

  it('honra AbortSignal', async () => {
    const abort = new AbortController()
    abort.abort()
    const out = await runHarnessFollowups({
      userText: 'x',
      initialResults: [{ type: 'plugin.insert', success: false, message: 'boom' }],
      evaluation: null,
      actionsSummary: '',
      projectId: 'p1',
      abort: abort.signal,
      chat: async () => ({ success: true, content: 'no' }),
      parseActions: () => [],
      execute: async () => [],
      getState: () => midiState({ nombre: 'X', notes: 4 }),
      formatResults: () => '',
    })
    assert.equal(out.stoppedReason, 'aborted')
    assert.match(formatHarnessStopLine(out.stoppedReason, 0), /detenido/)
  })

  it('sale sano cuando la reparación funciona', async () => {
    let n = 0
    const out = await runHarnessFollowups({
      userText: 'crea bajo',
      initialResults: [{ type: 'midi.clip.create', success: true, message: 'clip' }],
      evaluation: null,
      actionsSummary: '✓ clip',
      projectId: 'p1',
      maxRepairTurns: 3,
      chat: async () => ({
        success: true,
        content: '<<<ACTIONS\n[{"type":"midi.notes.set","payload":{}}]\nACTIONS>>>',
      }),
      parseActions: () => [{ type: 'midi.notes.set', payload: { pistaId: 't1' } }],
      execute: async () => {
        n += 1
        return [{ type: 'midi.notes.set', success: true, message: 'notas' }]
      },
      getState: () => midiState({ nombre: 'Bajo', notes: n > 0 ? 12 : 0 }),
      formatResults: () => '✓ notas',
    })
    assert.equal(out.stoppedReason, 'healthy')
    assert.ok(out.turns.length >= 1)
  })

  it('sigue pidiendo revisión solo tras mutar', () => {
    assert.equal(harnessReviewNeeded([{ type: 'plugin.lookup', success: true, message: 'ok' }]), false)
  })

  it('la firma de salud es estable', () => {
    const a = inspectDawHealth(midiState({ nombre: 'A', notes: 0 }), [
      { type: 'midi.clip.create', success: true, message: 'c' },
    ], null)
    const b = inspectDawHealth(midiState({ nombre: 'A', notes: 0 }), [
      { type: 'midi.clip.create', success: true, message: 'c' },
    ], null)
    assert.equal(healthSignature(a), healthSignature(b))
  })
})

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
} from '@jaswave/ai-harness'
import type { HarnessActionResult } from '@jaswave/ai-harness'
import type { DAWState } from '../../../shared/src/types/state'

function midiState(opts: {
  nombre: string
  notes: number
  tipo?: 'midi' | 'audio'
  markers?: Array<{ nombre: string; tiempo: number }>
}): DAWState {
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
            ? [{ id: 'c1', nombre: 'Clip', inicio: 0, duracion: 16, notas }]
            : [{ id: 'c1', nombre: 'Clip', inicio: 0, duracion: 16, notas: [] }],
        },
      ],
      marcadores: (opts.markers ?? []).map((m) => ({
        nombre: m.nombre,
        tiempo: m.tiempo,
        tipo: 'marcador',
      })),
    },
  } as unknown as DAWState
}

describe('agent-harness producción', () => {
  it('no repara si el DAW está sano', () => {
    const results: HarnessActionResult[] = [{ type: 'track.create', success: true, message: 'ok' }]
    const report = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), results, null)
    assert.equal(report.ok, true)
    assert.equal(harnessShouldRepair(report), false)
  })

  it('marca acciones fallidas; clips vacíos no son empty-midi', () => {
    const results: HarnessActionResult[] = [
      { type: 'midi.clip.create', success: true, message: 'clip' },
      { type: 'plugin.insert', success: false, message: 'VST no carga' },
    ]
    const report = inspectDawHealth(midiState({ nombre: 'Lead', notes: 0 }), results, null)
    assert.equal(harnessShouldRepair(report), true)
    assert.ok(report.errors.some((e) => e.code === 'action-failed'))
    assert.equal(report.errors.some((e) => e.code === 'empty-midi'), false)
  })

  it('marca instrumento faltante tras un musicBuild y plugins en error', () => {
    const built: HarnessActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
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
    const prev: HarnessActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
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
        { type: 'plugin.insert', payload: { nombre: 'JasWave Roles' } },
      ],
      [],
      attempted,
    )
    assert.equal(filtered.some((a) => String(a.payload?.nombre).includes('Analog')), false)
    assert.equal(filtered[0]?.payload?.nombre, 'JasWave Roles')
  })

  it('fingerprint distingue pistas', () => {
    assert.notEqual(
      actionFingerprint('track.create', { nombre: 'Bajo' }),
      actionFingerprint('track.create', { nombre: 'Pad' }),
    )
  })

  it('para el bucle si la firma de error no cambia (stale limit)', async () => {
    const broken: HarnessActionResult[] = [{ type: 'plugin.insert', success: false, message: 'boom' }]
    let chats = 0
    const out = await runHarnessFollowups({
      userText: 'pon analog lab',
      initialResults: broken,
      evaluation: null,
      actionsSummary: '✗ boom',
      projectId: 'p1',
      maxRepairTurns: 5,
      chat: async () => {
        chats += 1
        return {
          success: true,
          content: `intento ${chats}\n<<<ACTIONS\n[{"type":"midi.notes.set","payload":{"clipId":"c${chats}"}}]\nACTIONS>>>`,
        }
      },
      parseActions: () => [{ type: 'midi.notes.set', payload: { pistaId: 't1', clipId: `c${chats}` } }],
      execute: async () => [{ type: 'plugin.insert', success: false, message: 'boom' }],
      getState: () => midiState({ nombre: 'X', notes: 4 }),
      formatResults: (r) => r.map((x) => x.message).join('\n'),
    })
    assert.equal(out.stoppedReason, 'no-progress')
    assert.ok(chats >= 2)
  })

  it('plan incompleto tras mutar es error reparable', () => {
    const results: HarnessActionResult[] = [{ type: 'track.create', success: true, message: 'ok' }]
    const report = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), results, {
      planned: 2,
      done: 0,
      missing: ['Pista «Lead»', 'Pista «Pad»'],
      extraTracks: [],
      summary: '0/2',
      markdown: '',
      checks: [],
    })
    assert.ok(report.errors.some((e) => e.code === 'plan-incomplete'))
    assert.ok(report.debugDump.includes('Bajo'))
    assert.equal(harnessShouldRepair(report), true)
  })

  it('host-slot-unconfirmed cuando hay notas pero sin slot audit', () => {
    const built: HarnessActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
    const st = midiState({ nombre: 'Lead', notes: 16 })
    st.project!.tracks[0]!.plugins = [{ nombre: 'JasWave Roles', estado: 'cargado' } as never]
    const report = inspectDawHealth(st, built, null, {
      auditTracks: [
        {
          id: 't1',
          name: 'Lead',
          notes: 16,
          clips: 1,
          peak: 0,
          plugins: ['JasWave Roles'],
        },
      ],
    })
    assert.ok(report.errors.some((e) => e.code === 'host-slot-unconfirmed'))
  })

  it('sidechain aplicado emite aviso unverified', () => {
    const report = inspectDawHealth(midiState({ nombre: 'A', notes: 4 }), [], null, {
      sidechainApplied: true,
    })
    assert.ok(report.warnings.some((w) => w.code === 'sidechain-unverified'))
  })

  it('acción no soportada usa code action-unsupported', () => {
    const report = inspectDawHealth(midiState({ nombre: 'A', notes: 4 }), [
      { type: 'foo.bar', success: false, message: 'Acción no soportada: foo.bar' },
    ], null)
    assert.ok(report.errors.some((e) => e.code === 'action-unsupported'))
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
      getState: () => {
        const st = midiState({
          nombre: 'Bajo',
          notes: n > 0 ? 12 : 0,
          markers: [{ nombre: 'Tema', tiempo: 0 }],
        })
        st.project!.tracks[0]!.plugins = [{ nombre: 'JasWave Roles', estado: 'cargado' } as never]
        return st
      },
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

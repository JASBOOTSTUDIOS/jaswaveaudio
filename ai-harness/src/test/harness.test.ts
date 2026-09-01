import { describe, it, expect } from 'vitest'
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
  type HarnessActionResult,
} from '../loop/harness'
import type { DAWState } from '@jaswave/shared'

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

describe('harness producción', () => {
  it('no repara si el DAW está sano', () => {
    const results: HarnessActionResult[] = [{ type: 'track.create', success: true, message: 'ok' }]
    const report = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), results, null)
    expect(report.ok).toBe(true)
    expect(harnessShouldRepair(report)).toBe(false)
  })

  it('marca acciones fallidas y MIDI vacío tras generar', () => {
    const results: HarnessActionResult[] = [
      { type: 'midi.clip.create', success: true, message: 'clip' },
      { type: 'plugin.insert', success: false, message: 'VST no carga' },
    ]
    const report = inspectDawHealth(midiState({ nombre: 'Lead', notes: 0 }), results, null)
    expect(harnessShouldRepair(report)).toBe(true)
    expect(report.errors.some((e) => e.code === 'action-failed')).toBe(true)
    expect(report.errors.some((e) => e.code === 'empty-midi')).toBe(true)
  })

  it('marca instrumento faltante tras un musicBuild y plugins en error', () => {
    const built: HarnessActionResult[] = [{ type: 'daw.musicBuild', success: true, message: 'ok' }]
    const bare = inspectDawHealth(midiState({ nombre: 'Bajo', notes: 8 }), built, null)
    expect(bare.errors.some((e) => e.code === 'missing-instrument')).toBe(true)
    const crashed = midiState({ nombre: 'Lead', notes: 4 })
    crashed.project!.tracks[0]!.plugins = [{ nombre: 'Analog Lab', estado: 'error' } as never]
    const err = inspectDawHealth(crashed, built, null)
    expect(err.errors.some((e) => e.code === 'plugin-error')).toBe(true)
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
    expect(filtered.some((a) => a.type === 'daw.musicBuild')).toBe(false)
    expect(filtered[0]?.type).toBe('midi.clip.create')
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
    expect(filtered.some((a) => String(a.payload?.nombre).includes('Analog'))).toBe(false)
    expect(filtered[0]?.payload?.nombre).toBe('JasWave Roles')
  })

  it('fingerprint distingue pistas', () => {
    expect(actionFingerprint('track.create', { nombre: 'Bajo' })).not.toBe(
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
    expect(out.stoppedReason).toBe('no-progress')
    expect(chats).toBeGreaterThanOrEqual(2)
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
    expect(report.errors.some((e) => e.code === 'plan-incomplete')).toBe(true)
    expect(report.debugDump.includes('Bajo')).toBe(true)
    expect(harnessShouldRepair(report)).toBe(true)
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
    expect(report.errors.some((e) => e.code === 'host-slot-unconfirmed')).toBe(true)
  })

  it('sidechain aplicado emite aviso unverified', () => {
    const report = inspectDawHealth(midiState({ nombre: 'A', notes: 4 }), [], null, {
      sidechainApplied: true,
    })
    expect(report.warnings.some((w) => w.code === 'sidechain-unverified')).toBe(true)
  })

  it('acción no soportada usa code action-unsupported', () => {
    const report = inspectDawHealth(midiState({ nombre: 'A', notes: 4 }), [
      { type: 'foo.bar', success: false, message: 'Acción no soportada: foo.bar' },
    ], null)
    expect(report.errors.some((e) => e.code === 'action-unsupported')).toBe(true)
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
    expect(out.stoppedReason).toBe('no-progress')
    expect(out.turns.length).toBe(1)
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
    expect(out.stoppedReason).toBe('aborted')
    expect(formatHarnessStopLine(out.stoppedReason, 0)).toMatch(/detenido/)
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
    expect(out.stoppedReason).toBe('healthy')
    expect(out.turns.length).toBeGreaterThanOrEqual(1)
  })

  it('sigue pidiendo revisión solo tras mutar', () => {
    expect(harnessReviewNeeded([{ type: 'plugin.lookup', success: true, message: 'ok' }])).toBe(false)
  })

  it('la firma de salud es estable', () => {
    const a = inspectDawHealth(midiState({ nombre: 'A', notes: 0 }), [
      { type: 'midi.clip.create', success: true, message: 'c' },
    ], null)
    const b = inspectDawHealth(midiState({ nombre: 'A', notes: 0 }), [
      { type: 'midi.clip.create', success: true, message: 'c' },
    ], null)
    expect(healthSignature(a)).toBe(healthSignature(b))
  })
})

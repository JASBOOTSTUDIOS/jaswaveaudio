import { describe, it, expect } from 'vitest'
import { inspectProduction } from '../loop/production-audit'
import { listSectionGaps, parseBeatsRangeFromTask } from '../plan/section-coverage'
import type { DAWState } from '@jaswave/shared'

function state(opts: {
  tracks: Array<{
    id: string
    nombre: string
    notes: Array<{ pitch: number; inicio: number; duracion?: number }>
    clipStart?: number
    clipDur?: number
    plugins?: { nombre: string; estado?: string }[]
    volumen?: number
    paneo?: number
    silenciada?: boolean
    soloActiva?: boolean
    tags?: string[]
  }>
  markers?: Array<{ nombre: string; tiempo: number }>
}): DAWState {
  return {
    project: {
      tracks: opts.tracks.map((t) => ({
        id: t.id,
        nombre: t.nombre,
        tipo: 'midi',
        volumen: t.volumen,
        paneo: t.paneo,
        silenciada: t.silenciada,
        soloActiva: t.soloActiva,
        tags: t.tags,
        plugins: t.plugins ?? [],
        clips: [
          {
            id: `c-${t.id}`,
            nombre: t.nombre,
            inicio: t.clipStart ?? 0,
            duracion: t.clipDur ?? 32,
            notas: t.notes,
          },
        ],
      })),
      marcadores: (opts.markers ?? []).map((m) => ({
        nombre: m.nombre,
        tiempo: m.tiempo,
        tipo: 'marcador',
      })),
    },
  } as unknown as DAWState
}

describe('production audit', () => {
  it('parsea beats del checkbox de plan', () => {
    expect(parseBeatsRangeFromTask('MIDI «Drums» · sección Coro (beats 64–96)')).toEqual({
      start: 64,
      end: 96,
    })
  })

  it('detecta hueco de sección si el clip no cubre el marcador', () => {
    const st = state({
      tracks: [
        { id: 't1', nombre: 'Drums', notes: [{ pitch: 36, inicio: 0, duracion: 0.5 }], clipStart: 0, clipDur: 16 },
      ],
      markers: [
        { nombre: 'Intro', tiempo: 0 },
        { nombre: 'Coro', tiempo: 32 },
      ],
    })
    const gaps = listSectionGaps(st)
    expect(gaps.some((g) => g.section === 'Coro')).toBe(true)
  })

  it('midi-out-of-range en bajo con pitch 90', () => {
    const st = state({
      tracks: [
        {
          id: 'bass',
          nombre: 'Bajo',
          notes: Array.from({ length: 8 }, (_, i) => ({ pitch: 90, inicio: i, duracion: 0.5 })),
          tags: ['role:bass'],
          plugins: [{ nombre: 'Trilian' }],
        },
      ],
    })
    const report = inspectProduction(st, {
      pluginGuides: [
        {
          trackId: 'bass',
          pluginName: 'Trilian',
          role: 'bass',
          trackRole: 'bass',
          chromatic: true,
          range: { lo: 28, hi: 67 },
        },
      ],
    })
    expect(report.errors.some((e) => e.code === 'midi-out-of-range')).toBe(true)
  })

  it('midi-drum-off-map si el kit tiene escala de piano', () => {
    const st = state({
      tracks: [
        {
          id: 'drums',
          nombre: 'Drums',
          notes: [60, 62, 64, 65, 67, 69, 71, 72].map((pitch, i) => ({
            pitch,
            inicio: i * 0.25,
            duracion: 0.2,
          })),
          tags: ['role:drums'],
          plugins: [{ nombre: 'BFD Player' }],
        },
      ],
    })
    const report = inspectProduction(st, {
      pluginGuides: [
        {
          trackId: 'drums',
          pluginName: 'BFD Player',
          role: 'drums',
          trackRole: 'drums',
          chromatic: false,
          range: { lo: 35, hi: 81 },
          drumMapPitches: [36, 38, 42, 46],
        },
      ],
    })
    expect(report.errors.some((e) => e.code === 'midi-drum-off-map')).toBe(true)
  })

  it('mix-collapsed-center con ≥3 pistas pan 0', () => {
    const notes = [{ pitch: 36, inicio: 0, duracion: 1 }]
    const st = state({
      tracks: [
        { id: 'a', nombre: 'Drums', notes, volumen: 0.7, paneo: 0 },
        { id: 'b', nombre: 'Bass', notes, volumen: 0.75, paneo: 0 },
        { id: 'c', nombre: 'Keys', notes, volumen: 0.6, paneo: 0 },
      ],
    })
    const report = inspectProduction(st)
    expect(report.warnings.some((e) => e.code === 'mix-collapsed-center')).toBe(true)
  })

  it('midi-keyswitch-as-note con duración melódica', () => {
    const st = state({
      tracks: [
        {
          id: 'g',
          nombre: 'Guitar',
          notes: [
            { pitch: 24, inicio: 0, duracion: 1 },
            { pitch: 26, inicio: 1, duracion: 1 },
            { pitch: 60, inicio: 2, duracion: 0.5 },
          ],
          tags: ['role:guitar'],
          plugins: [{ nombre: 'Session Guitarist' }],
        },
      ],
    })
    const report = inspectProduction(st, {
      pluginGuides: [
        {
          trackId: 'g',
          pluginName: 'Session Guitarist',
          role: 'guitar',
          trackRole: 'guitar',
          chromatic: true,
          range: { lo: 40, hi: 88 },
          keyswitchPitches: [24, 26],
        },
      ],
    })
    expect(report.errors.some((e) => e.code === 'midi-keyswitch-as-note')).toBe(true)
  })

  it('clip-off-grid-section si el clip no solapa marcadores', () => {
    const st = state({
      tracks: [
        {
          id: 't1',
          nombre: 'Pad',
          notes: [{ pitch: 60, inicio: 0, duracion: 1 }],
          clipStart: 200,
          clipDur: 8,
        },
      ],
      markers: [
        { nombre: 'Intro', tiempo: 0 },
        { nombre: 'Outro', tiempo: 32 },
      ],
    })
    const report = inspectProduction(st)
    expect(report.warnings.some((e) => e.code === 'clip-off-grid-section')).toBe(true)
  })

  it('mix-defaults si varias pistas quedan en 0.8/pan 0', () => {
    const notes = [{ pitch: 36, inicio: 0, duracion: 1 }]
    const st = state({
      tracks: [
        { id: 'a', nombre: 'Drums', notes, volumen: 0.8, paneo: 0 },
        { id: 'b', nombre: 'Bass', notes, volumen: 0.8, paneo: 0 },
      ],
    })
    const report = inspectProduction(st, { builtProject: true })
    expect(report.errors.some((e) => e.code === 'mix-defaults')).toBe(true)
  })

  it('mix-muted-with-notes', () => {
    const st = state({
      tracks: [
        {
          id: 'a',
          nombre: 'Pad',
          notes: [{ pitch: 60, inicio: 0, duracion: 2 }],
          silenciada: true,
        },
      ],
    })
    const report = inspectProduction(st)
    expect(report.errors.some((e) => e.code === 'mix-muted-with-notes')).toBe(true)
  })

  it('listen-missing cuando requireListen y no hay bounce', () => {
    const st = state({
      tracks: [
        {
          id: 'a',
          nombre: 'Keys',
          notes: [{ pitch: 60, inicio: 0, duracion: 1 }],
          clipStart: 0,
          clipDur: 16,
        },
      ],
      markers: [{ nombre: 'Tema', tiempo: 0 }],
    })
    const report = inspectProduction(st, { requireListen: true, mutatedMidi: true })
    expect(report.errors.some((e) => e.code === 'listen-missing')).toBe(true)
  })

  it('vst-role-mismatch BFD en pista piano', () => {
    const st = state({
      tracks: [
        {
          id: 'p',
          nombre: 'Piano',
          notes: [{ pitch: 60, inicio: 0, duracion: 1 }],
          tags: ['role:piano'],
          plugins: [{ nombre: 'BFD Player' }],
        },
      ],
    })
    const report = inspectProduction(st, {
      pluginGuides: [
        {
          trackId: 'p',
          pluginName: 'BFD Player',
          role: 'drums',
          trackRole: 'piano',
          chromatic: false,
          range: { lo: 35, hi: 81 },
        },
      ],
    })
    expect(report.errors.some((e) => e.code === 'vst-role-mismatch')).toBe(true)
  })
})

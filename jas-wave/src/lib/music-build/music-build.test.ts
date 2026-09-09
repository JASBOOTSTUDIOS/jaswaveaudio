import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { expandSectionsToBarPlan } from './executor'
import { mergeMusicBuildSpec, specFromPrompt } from './spec'
import { validateMidiClip } from './validator'
import { composeMidiFromBrief, parseMidiBriefFromText } from '../midi-song-generator'
import type { GeneratedNote } from '../midi-song-generator'

describe('music-build spec', () => {
  it('parsea BPM, tonalidad, duración y forma de un brief de canción', () => {
    const spec = specFromPrompt(
      'Créame una canción de reggaetón moderna, 95 BPM, A menor, 3 minutos, con intro, verso, pre-coro, coro, segundo verso, coro y outro.',
    )
    assert.equal(spec.bpm, 95)
    assert.equal(spec.scale, 'minor')
    assert.match(spec.keyLabel, /A menor|la menor/i)
    assert.ok(spec.minutes >= 2.5)
    assert.ok(spec.sections.some((s) => /intro/i.test(s.name)))
    assert.ok(spec.sections.some((s) => /verso/i.test(s.name)))
    assert.ok(spec.sections.some((s) => /estribillo|coro/i.test(s.name)))
    const roles = spec.tracks.map((t) => t.rol)
    assert.ok(roles.includes('drums'))
    assert.ok(roles.includes('bass'))
  })

  it('parsea bachata 3 minutos con plantilla de pistas', () => {
    const spec = specFromPrompt('créame una canción de bachata de 3 minutos')
    assert.equal(spec.genero, 'bachata')
    assert.equal(spec.bpm, 125)
    assert.ok(spec.minutes >= 2.9)
    assert.ok(spec.tracks.length >= 5)
    assert.ok(spec.tracks.some((t) => /guitar|requinto|ritm/i.test(t.nombre)))
    assert.ok(spec.tracks.some((t) => t.rol === 'bass'))
    const bars = spec.sections.reduce((n, s) => n + s.bars, 0)
    assert.ok(bars >= 80, `esperaba ~94 barras para 3min@125, got ${bars}`)
  })

  it('merge IA gana sobre heurística (metal vs worship defaults)', () => {
    const base = specFromPrompt('canción genérica')
    const merged = mergeMusicBuildSpec(base, {
      genero: 'metal',
      progresion: [1, 6, 3, 7],
      secciones: [
        { nombre: 'Riff', bars: 4, degrees: [1, 1, 6, 6], density: 0.95 },
        { nombre: 'Breakdown', bars: 4, degrees: [1, 7, 6, 5], density: 0.4, kind: 'breakdown' },
      ],
      pistas: [
        { nombre: 'Drums', rol: 'drums', articulacion: 'drums' },
        { nombre: 'Rhythm', rol: 'guitar', articulacion: 'strum' },
      ],
    })
    assert.equal(merged.genero, 'metal')
    assert.deepEqual(merged.degrees, [1, 6, 3, 7])
    assert.equal(merged.sections.length, 2)
    assert.deepEqual(merged.sections[0]!.degrees, [1, 1, 6, 6])
    assert.equal(merged.tracks.length, 2)
    assert.equal(merged.tracks[0]!.rol, 'drums')
  })

  it('barPlan metal ≠ ambient con el mismo motor', () => {
    const metalPlan = expandSectionsToBarPlan(
      [
        { name: 'Riff', bars: 4, degrees: [1, 1, 6, 6], density: 1, kind: 'chorus' },
        { name: 'Break', bars: 4, degrees: [1, 7, 6, 5], density: 0.3, kind: 'breakdown' },
      ],
      [1, 6, 3, 7],
    )
    const ambientPlan = expandSectionsToBarPlan(
      [
        { name: 'Pad A', bars: 4, degrees: [1, 4, 1, 5], density: 0.35, kind: 'intro' },
        { name: 'Pad B', bars: 4, degrees: [6, 4, 1, 5], density: 0.5, kind: 'verse' },
      ],
      [1, 4, 5, 1],
    )
    const brief = parseMidiBriefFromText('pad Am', 100)
    brief.articulation = 'pad'
    brief.minutes = 0.5
    brief.degrees = [1, 6, 3, 7]
    const metal = composeMidiFromBrief(brief, { seed: 1, bpm: 140, barPlan: metalPlan, aiDirected: true })
    brief.degrees = [1, 4, 5, 1]
    const ambient = composeMidiFromBrief(brief, { seed: 1, bpm: 70, barPlan: ambientPlan, aiDirected: true })
    assert.notEqual(
      metal.notes.slice(0, 12).map((n) => n.pitch).join(','),
      ambient.notes.slice(0, 12).map((n) => n.pitch).join(','),
    )
    assert.match(metal.structureLabel, /ai-form/)
  })
})

describe('music-build validator', () => {
  it('acepta un bajo en rango y escala de La menor', () => {
    const notes: GeneratedNote[] = [
      { pitch: 45, inicio: 0, duracion: 1, velocidad: 80 },
      { pitch: 48, inicio: 1, duracion: 1, velocidad: 76 },
      { pitch: 52, inicio: 2, duracion: 1, velocidad: 78 },
    ]
    const issues = validateMidiClip({
      notes,
      rol: 'bass',
      keyRoot: 45,
      scale: 'minor',
      trackName: 'Bajo',
    })
    assert.equal(issues.filter((i) => i.severity === 'error').length, 0)
  })

  it('marca vacío como error y registro absurdo como aviso', () => {
    assert.ok(
      validateMidiClip({
        notes: [],
        rol: 'bass',
        keyRoot: 45,
        scale: 'minor',
        trackName: 'Bajo',
      }).some((i) => i.code === 'empty'),
    )
    const crazy: GeneratedNote[] = [
      { pitch: 90, inicio: 0, duracion: 1, velocidad: 80 },
      { pitch: 93, inicio: 1, duracion: 1, velocidad: 80 },
      { pitch: 96, inicio: 2, duracion: 1, velocidad: 80 },
    ]
    assert.ok(
      validateMidiClip({
        notes: crazy,
        rol: 'bass',
        keyRoot: 45,
        scale: 'minor',
        trackName: 'Bajo',
      }).some((i) => i.code === 'range'),
    )
  })
})

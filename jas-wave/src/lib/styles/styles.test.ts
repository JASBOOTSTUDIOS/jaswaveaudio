/**
 * Tests: StyleProfile extract/apply + PDF score bytes.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { MidiClip, MidiNote } from '@jaswave/shared'
import { extractStyleProfile, seedMesiasWorshipDrumProfile } from '../styles/extract-style-profile'
import { applyStyleProfileToNotes, pitchesDifferEnough } from '../styles/apply-style-profile'
import { buildScorePdfBytes, isDrumishNotes } from '../midi-score-export'

function note(pitch: number, inicio: number, duracion = 0.25, velocidad = 90): MidiNote {
  return {
    id: `n-${pitch}-${inicio}`,
    pitch,
    inicio,
    duracion,
    velocidad,
    canal: 0,
    presion: 0,
    seleccionada: false,
  }
}

function clip(notas: MidiNote[], duracion = 16): MidiClip {
  return {
    id: 'clip-1',
    nombre: 'Test',
    trackId: 't1',
    inicio: 0,
    duracion,
    color: '#000',
    seleccionado: false,
    tipo: 'midi',
    notas,
    velocidadGlobal: 100,
    cuantizacion: 0.25,
    loop: { activo: false, inicio: 0, fin: duracion },
  }
}

describe('extractStyleProfile', () => {
  it('extrae drums sin embeber notas', () => {
    const notas = [
      note(36, 0),
      note(42, 0.5),
      note(38, 1, 0.2, 110),
      note(38, 1.25, 0.08, 40),
      note(36, 2),
      note(38, 3, 0.2, 110),
    ]
    const p = extractStyleProfile(clip(notas, 4), { bpm: 72, trackName: 'Batería', nombre: 'Test drums' })
    assert.equal(p.rol, 'drums')
    assert.equal(p.bpm, 72)
    assert.ok(p.stats.kick >= 1)
    assert.ok(p.stats.snareGhost >= 1)
    assert.ok(p.summaryText.includes('drums'))
    assert.ok(!('notas' in p))
  })

  it('seed Mesías tiene kick grid denso', () => {
    const seed = seedMesiasWorshipDrumProfile()
    assert.equal(seed.id, 'style-seed-mesias-firmthm-drums')
    assert.ok((seed.stats.kickGrid16[0] ?? 0) > 0)
    assert.ok((seed.stats.snareGrid16[4] ?? 0) > 0)
  })
})

describe('applyStyleProfileToNotes', () => {
  it('genera notas nuevas (no copy-paste de pitches origen ficticio)', () => {
    const profile = seedMesiasWorshipDrumProfile()
    const originPitches = [60, 62, 64, 65, 67]
    const generated = applyStyleProfileToNotes(profile, { bars: 2, seed: 7 })
    assert.ok(generated.length > 8)
    const pitches = generated.map((n) => n.pitch)
    assert.ok(pitchesDifferEnough(originPitches, pitches, 0.2))
    assert.ok(generated.some((n) => n.pitch === 36 || n.pitch === 38))
  })
})

describe('midi-score-export', () => {
  it('detecta drums y produce PDF válido', async () => {
    const notas = [note(36, 0), note(38, 1), note(42, 0.5), note(36, 2), note(38, 3)]
    assert.equal(isDrumishNotes(notas), true)
    const bytes = await buildScorePdfBytes(notas, { bpm: 72, drums: true, title: 'Test Drums' })
    assert.ok(bytes.length > 100)
    const head = String.fromCharCode(...bytes.slice(0, 4))
    assert.equal(head, '%PDF')
  })

  it('produce PDF melódico', async () => {
    const notas = [note(60, 0, 0.5), note(62, 0.5), note(64, 1), note(65, 1.5), note(67, 2, 1)]
    const bytes = await buildScorePdfBytes(notas, { bpm: 100, drums: false, title: 'Melody' })
    assert.ok(bytes.byteLength > 100)
    assert.equal(bytes[0], 0x25) // %
    assert.equal(bytes[1], 0x50) // P
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MidiNote } from '@jaswave/shared'
import {
  diffMidiNotes,
  emptyMidiClipMdStub,
  formatMidiNotesDiffForPrompt,
  midiClipDocSlug,
  parseMidiClipMd,
  pitchToName,
  serializeMidiClipMd,
} from './midi-clip-markdown'

function note(partial: Partial<MidiNote> & { id: string; pitch: number }): MidiNote {
  return {
    id: partial.id,
    pitch: partial.pitch,
    velocidad: partial.velocidad ?? 80,
    inicio: partial.inicio ?? 0,
    duracion: partial.duracion ?? 0.5,
    canal: partial.canal ?? 0,
    presion: 0,
    seleccionada: false,
    mute: partial.mute,
    articulation: partial.articulation,
    source: partial.source,
  }
}

describe('midi-clip-markdown', () => {
  it('slug estable por clipId', () => {
    assert.equal(midiClipDocSlug('ABC 12'), 'clip-abc-12.md')
  })

  it('pitchToName', () => {
    assert.equal(pitchToName(60), 'C4')
    assert.equal(pitchToName(61), 'C#4')
  })

  it('round-trip serialize → parse', () => {
    const notas = [
      note({ id: 'n1', pitch: 60, inicio: 0, duracion: 0.5, velocidad: 96, source: 'generated' }),
      note({ id: 'n2', pitch: 67, inicio: 1, duracion: 0.25, velocidad: 70, mute: true }),
    ]
    const md = serializeMidiClipMd(
      {
        id: 'c1',
        nombre: 'Lead',
        trackId: 't1',
        inicio: 0,
        duracion: 16,
        tipo: 'midi',
        notas,
        velocidadGlobal: 100,
        cuantizacion: 0.25,
        color: '#0f0',
        seleccionado: false,
        loop: { activo: false, inicio: 0, fin: 16 },
      },
      { bpm: 120, compas: '4/4', instrumentoHint: 'Serum' },
    )
    assert.match(md, /clipId: c1/)
    assert.match(md, /## Notas/)
    const parsed = parseMidiClipMd(md)
    assert.deepEqual(parsed.errors, [])
    assert.equal(parsed.meta.clipId, 'c1')
    assert.equal(parsed.meta.trackId, 't1')
    assert.equal(parsed.meta.bpm, 120)
    assert.equal(parsed.notas.length, 2)
    assert.equal(parsed.notas[0]?.id, 'n1')
    assert.equal(parsed.notas[0]?.pitch, 60)
    assert.equal(parsed.notas[0]?.velocidad, 96)
    assert.equal(parsed.notas[1]?.mute, true)
  })

  it('diffMidiNotes por id', () => {
    const before = [note({ id: 'a', pitch: 60, velocidad: 80 }), note({ id: 'b', pitch: 62 })]
    const after = [
      note({ id: 'a', pitch: 60, velocidad: 100 }),
      note({ id: 'c', pitch: 64 }),
    ]
    const d = diffMidiNotes(before, after)
    assert.deepEqual(
      d.removed.map((n) => n.id),
      ['b'],
    )
    assert.deepEqual(
      d.added.map((n) => n.id),
      ['c'],
    )
    assert.equal(d.changed.length, 1)
    assert.ok(d.changed[0]?.fields.some((f) => f.field === 'velocidad'))
    assert.match(formatMidiNotesDiffForPrompt(d), /Diff notas/)
  })

  it('empty stub parseable', () => {
    const stub = emptyMidiClipMdStub({
      clipId: 'c-empty',
      trackId: 't1',
      nombre: 'Pad',
      inicio: 0,
      duracion: 32,
      rol: 'pad',
      genero: 'ambient',
    })
    const p = parseMidiClipMd(stub)
    assert.equal(p.notas.length, 0)
    assert.equal(p.meta.clipId, 'c-empty')
    assert.equal(p.meta.rol, 'pad')
  })
})

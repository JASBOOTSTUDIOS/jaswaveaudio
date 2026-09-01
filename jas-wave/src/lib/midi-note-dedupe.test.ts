/**
 * npx tsx --test src/lib/midi-note-dedupe.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { countDuplicateMidiNotes, dedupeMidiNotes } from './midi-note-dedupe'

describe('midi-note-dedupe', () => {
  it('conserva una nota por pitch+inicio', () => {
    const notes = [
      { id: 'a', pitch: 60, inicio: 0, duracion: 1, velocidad: 80 },
      { id: 'b', pitch: 60, inicio: 0, duracion: 1, velocidad: 90 },
      { id: 'c', pitch: 62, inicio: 1, duracion: 0.5, velocidad: 70 },
      { id: 'd', pitch: 60, inicio: 0.0004, duracion: 1, velocidad: 50 },
    ]
    const { kept, removedCount } = dedupeMidiNotes(notes)
    assert.equal(kept.length, 2)
    assert.equal(removedCount, 2)
    assert.equal(kept.find((n) => n.pitch === 60)?.id, 'b')
    assert.equal(kept.find((n) => n.pitch === 62)?.id, 'c')
  })

  it('cuenta duplicados', () => {
    assert.equal(
      countDuplicateMidiNotes([
        { pitch: 53, inicio: 0 },
        { pitch: 53, inicio: 0 },
        { pitch: 53, inicio: 0 },
        { pitch: 55, inicio: 1 },
      ]),
      2,
    )
  })
})

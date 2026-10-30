import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildMidiNotesAnchor, formatMusicalSelectionForPrompt, selectionRelevantForText } from './ai-selection-context'

const ancla = (edadMs: number) => ({
  ...buildMidiNotesAnchor({
    trackId: 't1',
    trackName: 'MIDI 1',
    clipId: 'c1',
    clipName: 'Intro',
    notes: [{ id: 'n1', pitch: 62, inicio: 0, duracion: 1, velocidad: 80 }],
  }),
  createdAt: Date.now() - edadMs,
})

describe('selección anclada: relevancia para el pedido', () => {
  it('se usa cuando el pedido la menciona, aunque sea vieja', () => {
    assert.equal(selectionRelevantForText(ancla(3_600_000), 'humaniza estas notas'), true)
    assert.equal(selectionRelevantForText(ancla(3_600_000), '[selección: 1 nota] súbelas una octava'), true)
  })
  it('no sesga un pedido global que no la menciona', () => {
    assert.equal(selectionRelevantForText(ancla(1000), 'completa la canción con bajo y batería'), false)
    assert.equal(formatMusicalSelectionForPrompt(ancla(1000), 'completa la canción'), '')
  })
  it('una selección reciente sirve para un pedido ambiguo; una vieja no', () => {
    assert.equal(selectionRelevantForText(ancla(10_000), 'transpón una octava'), true)
    assert.equal(selectionRelevantForText(ancla(600_000), 'transpón una octava'), false)
  })
  it('sin texto mantiene el comportamiento anterior', () => {
    assert.match(formatMusicalSelectionForPrompt(ancla(600_000)), /Selección musical anclada/)
  })
})

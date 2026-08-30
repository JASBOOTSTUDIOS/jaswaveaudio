/**
 * npx tsx --test src/lib/describe-action.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { describeActionForUser, labelForAction } from './describe-action'
import {
  advanceChecklistAfterStep,
  buildChecklistFromActions,
  normalizeChecklist,
} from './ai-agent-checklist'

describe('describeActionForUser', () => {
  it('describe tempo', () => {
    const d = describeActionForUser({ type: 'project.setBpm', payload: { bpm: 72 } })
    assert.match(d.label, /72/)
    assert.match(d.label, /tempo/i)
  })

  it('describe notes.set con conteo', () => {
    const d = describeActionForUser({
      type: 'midi.notes.set',
      payload: {
        pistaId: 't1',
        clipId: 'c1',
        notas: [
          { pitch: 60, inicio: 0, duracion: 1 },
          { pitch: 64, inicio: 1, duracion: 1 },
        ],
      },
    })
    assert.match(d.label, /2 nota/)
    assert.match(d.label, /60–64/)
  })

  it('describe dedupe', () => {
    const d = describeActionForUser({
      type: 'midi.notes.dedupe',
      payload: { pistaId: 'bass-track', clipId: 'clip-1' },
    })
    assert.match(d.label, /duplicad/i)
    assert.ok(d.detail?.includes('midi.notes.dedupe'))
  })

  it('labelForAction alias', () => {
    assert.match(labelForAction({ type: 'track.create', payload: { nombre: 'Pad' } }), /Pad/)
  })
})

describe('checklist advance after approve', () => {
  it('advanceChecklistAfterStep marca done y avanza', () => {
    const list = buildChecklistFromActions([
      { type: 'project.setBpm', payload: { bpm: 70 } },
      { type: 'daw.musicBuild', payload: { prompt: 'x' } },
    ])!
    const stepId = list.items[0]!.id
    const next = advanceChecklistAfterStep(list, stepId, 'done')
    assert.equal(next.items[0]!.status, 'done')
    assert.equal(next.currentIndex, 1)
    assert.equal(next.items[1]!.status, 'ready')
  })

  it('descartar paso = skipped', () => {
    const list = normalizeChecklist({
      status: 'active',
      currentIndex: 0,
      items: [
        {
          id: 'a',
          label: 'Tempo',
          status: 'ready',
          actions: [{ type: 'project.setBpm', payload: { bpm: 80 } }],
        },
      ],
    })
    const next = advanceChecklistAfterStep(list, 'a', 'skipped')
    assert.equal(next.items[0]!.status, 'skipped')
    assert.equal(next.status, 'done')
  })
})

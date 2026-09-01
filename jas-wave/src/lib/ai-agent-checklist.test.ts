/**
 * Checklist del agente.
 * npx tsx --test src/lib/ai-agent-checklist.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildChecklistFromActions,
  labelForAction,
  normalizeChecklist,
  parseChecklistFromText,
} from './ai-agent-checklist'

describe('ai-agent-checklist', () => {
  it('buildChecklistFromActions marca el primero ready', () => {
    const list = buildChecklistFromActions([
      { type: 'project.setBpm', payload: { bpm: 72 } },
      { type: 'daw.musicBuild', payload: { prompt: 'lento', bpm: 72 } },
    ])
    assert.ok(list)
    assert.equal(list!.items.length, 2)
    assert.equal(list!.items[0]!.status, 'ready')
    assert.equal(list!.items[1]!.status, 'pending')
    assert.match(labelForAction({ type: 'project.setBpm', payload: { bpm: 72 } }), /72/)
  })

  it('parseChecklistFromText lee bloque del modelo', () => {
    const text = `ok
<<<CHECKLIST
[{"id":"a","label":"Tempo","actions":[{"type":"project.setBpm","payload":{"bpm":70}}]}]
CHECKLIST>>>`
    const list = parseChecklistFromText(text)
    assert.equal(list?.items[0]?.label, 'Tempo')
    assert.equal(list?.items[0]?.actions[0]?.type, 'project.setBpm')
  })

  it('normalizeChecklist avanza ready', () => {
    const list = normalizeChecklist({
      status: 'active',
      currentIndex: 1,
      items: [
        { id: '1', label: 'a', status: 'done', actions: [{ type: 'project.setBpm', payload: {} }] },
        { id: '2', label: 'b', status: 'pending', actions: [{ type: 'daw.musicBuild', payload: {} }] },
      ],
    })
    assert.equal(list.items[1]!.status, 'ready')
  })

  it('labelForAction usa descripción humana', () => {
    assert.match(
      labelForAction({
        type: 'midi.notes.dedupe',
        payload: { pistaId: 't', clipId: 'c' },
      }),
      /duplicad/i,
    )
  })
})

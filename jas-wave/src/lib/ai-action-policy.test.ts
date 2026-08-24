/**
 * Tests: política de modos IA, BPM parse, gate de mutación.
 * npx tsx --test src/lib/ai-action-policy.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  forcePreviewAplicar,
  isDestructiveAction,
  isMutatingAction,
  modeBlocksMutation,
  partitionActions,
  withAplicarTrue,
} from './ai-action-policy'
import { fallbackActionsFromUserIntent } from './ai-daw-agent'
import { parseMidiBriefFromText } from './midi-song-generator'
import { detectAgentMode } from './ai-modes'

describe('ai-action-policy', () => {
  it('plan/think bloquean mutación', () => {
    assert.equal(modeBlocksMutation('plan'), true)
    assert.equal(modeBlocksMutation('think'), true)
    assert.equal(modeBlocksMutation('create'), false)
  })

  it('forcePreviewAplicar pone aplicar:false en plan', () => {
    const out = forcePreviewAplicar(
      [{ type: 'daw.generateMidiSong', payload: { aplicar: true, prompt: 'x' } }],
      'think',
    )
    assert.equal(out[0]!.payload!.aplicar, false)
  })

  it('withAplicarTrue fuerza apply', () => {
    const out = withAplicarTrue([{ type: 'daw.musicBuild', payload: { aplicar: false } }])
    assert.equal(out[0]!.payload!.aplicar, true)
  })

  it('doc.write no cuenta como mutación DAW', () => {
    assert.equal(isMutatingAction({ type: 'doc.write', payload: { slug: 'plan.md', content: '# x' } }), false)
  })

  it('detecta destructivas y lote borra todo', () => {
    assert.equal(isDestructiveAction({ type: 'track.delete', payload: { trackId: 'a' } }), true)
    assert.equal(isMutatingAction({ type: 'plugin.lookup', payload: { nombre: 'x' } }), false)
    const part = partitionActions(
      [
        { type: 'track.delete', payload: { trackId: '1' } },
        { type: 'track.delete', payload: { trackId: '2' } },
      ],
      'borra todo',
    )
    assert.ok(part.destructive.length >= 2)
  })
})

describe('BPM en brief y fallback', () => {
  it('parseMidiBriefFromText entiende 72 BPM', () => {
    const b = parseMidiBriefFromText('worship moderno a 72 BPM en C', 120)
    assert.equal(b.bpm, 72)
  })

  it('fallback emite project.setBpm para 72 bpm', () => {
    const actions = fallbackActionsFromUserIntent('crea un pad a 72 bpm', undefined, 'create')
    const bpm = actions.find((a) => a.type === 'project.setBpm')
    assert.ok(bpm)
    assert.equal(bpm!.payload!.bpm, 72)
  })

  it('fallback en think no aplica midi automáticamente', () => {
    const actions = fallbackActionsFromUserIntent('crea una canción worship', undefined, 'think')
    const midi = actions.find((a) => a.type === 'daw.generateMidiSong' || a.type === 'daw.musicBuild')
    if (midi) {
      assert.notEqual(midi.payload?.aplicar, true)
    }
    assert.equal(detectAgentMode('piensa el arreglo', 'auto'), 'think')
  })
})

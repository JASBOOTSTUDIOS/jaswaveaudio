/**
 * Tests: política de modos IA, BPM parse, gate de mutación.
 * npx tsx --test src/lib/ai-action-policy.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  forcePreviewAplicar,
  ensureMusicBuildForFullProject,
  isDestructiveAction,
  isMutatingAction,
  modeBlocksMutation,
  autonomyBlocksMutation,
  needsPermissionConfirm,
  partitionActions,
  withAplicarTrue,
} from './ai-action-policy'
import { permissionManager } from '../../../shared/src/state/permissions'
import { fallbackActionsFromUserIntent } from './ai-daw-agent'
import { parseMidiBriefFromText } from './midi-song-generator'
import { detectAgentMode } from './ai-modes'

describe('ai-action-policy', () => {
  it('plan/think/ask bloquean mutación', () => {
    assert.equal(modeBlocksMutation('plan'), true)
    assert.equal(modeBlocksMutation('think'), true)
    assert.equal(modeBlocksMutation('ask'), true)
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

  it('ensureMusicBuildForFullProject sustituye generateMidiSong en canciones multi-pista', () => {
    const prompt =
      'quiero que me crees una cancion de adoracion moderna en D mayor con BFD, Descent guitar y pads'
    const out = ensureMusicBuildForFullProject(
      [{ type: 'daw.generateMidiSong', payload: { aplicar: true, prompt } }],
      prompt,
      { aplicar: true },
    )
    assert.equal(out.some((a) => a.type === 'daw.musicBuild'), true)
    assert.equal(out.some((a) => a.type === 'daw.generateMidiSong'), false)
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

  it('FULL_AUTONOMY no pide confirmación en destructivas', () => {
    permissionManager.setUserConfig(
      { level: 'FULL_AUTONOMY', overrides: [], allowUnsafeTools: false },
      'user',
    )
    assert.equal(
      needsPermissionConfirm({ type: 'track.delete', payload: { trackId: 'a' } }),
      false,
    )
    permissionManager.setUserConfig(
      { level: 'CONFIRM', overrides: [], allowUnsafeTools: false },
      'user',
    )
  })

  it('READ_ONLY bloquea mutación por autonomía', () => {
    permissionManager.setUserConfig(
      { level: 'READ_ONLY', overrides: [], allowUnsafeTools: false },
      'user',
    )
    assert.equal(autonomyBlocksMutation(), true)
    permissionManager.setUserConfig(
      { level: 'CONFIRM', overrides: [], allowUnsafeTools: false },
      'user',
    )
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
    assert.ok(midi)
    assert.equal(midi!.type, 'daw.musicBuild')
    if (midi) {
      assert.notEqual(midi.payload?.aplicar, true)
    }
    assert.equal(detectAgentMode('piensa el arreglo', 'auto'), 'think')
  })

  it('fallback multi-pista adoración usa musicBuild (no un solo clip)', () => {
    const prompt =
      'quiero que me crees una cancion de adoracion moderna en D mayor con bateria BFD, piano Descent, 3 guitarras, bajo 4Front y 4 pads'
    const actions = fallbackActionsFromUserIntent(prompt, undefined, 'create')
    assert.equal(actions.some((a) => a.type === 'daw.musicBuild'), true)
    assert.equal(actions.some((a) => a.type === 'daw.generateMidiSong'), false)
  })
})

/**
 * MIDI Learn: matching, catálogo, preset SMC-MIXER.
 * npx tsx --test src/lib/midi-map.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMidiMapCatalog,
  eatListsFromBindings,
  looksLikeSmcMixer,
  mergeSmcMixerPreset,
  midiMatchesBinding,
  noteDisplayName,
  smcMixerCcPreset,
  triggersMatch,
  triggerFromMidi,
  upsertBinding,
} from './midi-map'

describe('midi-map', () => {
  it('nombres de nota MIDI', () => {
    assert.equal(noteDisplayName(60), 'C4')
    assert.equal(noteDisplayName(64), 'E4')
  })

  it('captura nota y CC', () => {
    const note = triggerFromMidi({ kind: 'noteOn', channel: 0, pitch: 64, velocity: 100 })
    assert.deepEqual(note, { kind: 'note', channel: 'omni', pitch: 64 })
    const cc = triggerFromMidi({ kind: 'cc', channel: 3, cc: 64, value: 127 })
    assert.deepEqual(cc, { kind: 'cc', channel: 'omni', cc: 64 })
    assert.equal(triggerFromMidi({ kind: 'noteOff', channel: 0, pitch: 64, velocity: 0 }), null)
  })

  it('catálogo incluye sustain y play', () => {
    const cat = buildMidiMapCatalog(8)
    assert.ok(cat.some((t) => t.id === 'midi.fn.sustain'))
    assert.ok(cat.some((t) => t.id === 'action.transport.togglePlay'))
    assert.ok(cat.some((t) => t.id === 'mixer.track.0.volume'))
  })

  it('preset SMC-MIXER mapea faders 40-47 y knobs 30-37', () => {
    const p = smcMixerCcPreset()
    assert.equal(p.length, 16)
    assert.ok(
      p.some((b) => b.targetId === 'mixer.track.0.volume' && b.trigger.kind === 'cc' && b.trigger.cc === 40),
    )
    assert.ok(
      p.some((b) => b.targetId === 'mixer.track.7.pan' && b.trigger.kind === 'cc' && b.trigger.cc === 37),
    )
    assert.equal(looksLikeSmcMixer('M-VAVE SMC-MIXER'), true)
    assert.equal(looksLikeSmcMixer('Yamaha PSR-E373'), false)
  })

  it('eat lists y upsert reemplazan el mismo trigger', () => {
    const merged = mergeSmcMixerPreset([])
    const eat = eatListsFromBindings(merged)
    assert.ok(eat.ccs.includes('40'))
    assert.ok(eat.ccs.includes('30'))
    const one = upsertBinding([], {
      targetId: 'midi.fn.sustain',
      trigger: { kind: 'cc', channel: 'omni', cc: 64 },
    })
    const two = upsertBinding(one, {
      targetId: 'action.transport.togglePlay',
      trigger: { kind: 'cc', channel: 'omni', cc: 64 },
    })
    assert.equal(two.length, 1)
    assert.equal(two[0]?.targetId, 'action.transport.togglePlay')
    assert.equal(triggersMatch(two[0]!.trigger, { kind: 'cc', channel: 2, cc: 64 }), true)
    assert.equal(
      midiMatchesBinding(
        { kind: 'cc', channel: 0, cc: 64, value: 90 },
        { kind: 'cc', channel: 'omni', cc: 64 },
      ),
      true,
    )
  })
})

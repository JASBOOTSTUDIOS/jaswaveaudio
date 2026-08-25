/**
 * MIDI hardware: parser + grabador.
 * npx tsx --test src/lib/midi-controller.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { channelFilterAllows, parseMidiMessage } from './midi-bytes'
import {
  clipSpanBeats,
  createMidiRecorder,
  flushRecorder,
  quantizeBeat,
  recordedToClipNotes,
  recorderNoteOff,
  recorderNoteOn,
} from './midi-note-recorder'
import { createPadSustain, padNoteOff, padNoteOn, padPedal } from './midi-sustain'

describe('parseMidiMessage', () => {
  it('note on / note off / note on vel 0', () => {
    const on = parseMidiMessage([0x90, 60, 100])
    assert.equal(on.msg?.kind, 'noteOn')
    if (on.msg?.kind === 'noteOn') {
      assert.equal(on.msg.pitch, 60)
      assert.equal(on.msg.velocity, 100)
      assert.equal(on.msg.channel, 0)
    }
    const off = parseMidiMessage([0x80, 60, 40])
    assert.equal(off.msg?.kind, 'noteOff')
    const zero = parseMidiMessage([0x91, 64, 0])
    assert.equal(zero.msg?.kind, 'noteOff')
    if (zero.msg?.kind === 'noteOff') assert.equal(zero.msg.channel, 1)
  })

  it('CC y running status', () => {
    const first = parseMidiMessage([0xb0, 64, 127])
    assert.equal(first.msg?.kind, 'cc')
    if (first.msg?.kind === 'cc') {
      assert.equal(first.msg.cc, 64)
      assert.equal(first.msg.value, 127)
    }
    const run = parseMidiMessage([64, 0], first.runningStatus)
    assert.equal(run.msg?.kind, 'cc')
    if (run.msg?.kind === 'cc') assert.equal(run.msg.value, 0)
  })

  it('filtro de canal', () => {
    assert.equal(channelFilterAllows('omni', 3), true)
    assert.equal(channelFilterAllows(0, 0), true)
    assert.equal(channelFilterAllows(2, 0), false)
  })
})

describe('midi-note-recorder', () => {
  it('empareja on/off y convierte a beats', () => {
    let rec = createMidiRecorder(0)
    rec = recorderNoteOn(rec, 60, 100, 0, 0)
    rec = recorderNoteOff(rec, 60, 0.5, 0)
    const notes = recordedToClipNotes(flushRecorder(rec, 0.5), 0, 120, 0)
    assert.equal(notes.length, 1)
    assert.equal(notes[0]?.pitch, 60)
    assert.equal(notes[0]?.source, 'recorded')
    assert.ok(Math.abs((notes[0]?.inicio ?? -1) - 0) < 1e-6)
    assert.ok(Math.abs((notes[0]?.duracion ?? 0) - 1) < 1e-6)
  })

  it('cierra notas sostenidas al flush', () => {
    let rec = createMidiRecorder(1)
    rec = recorderNoteOn(rec, 64, 80, 1.2, 0)
    const raw = flushRecorder(rec, 2)
    assert.equal(raw.length, 1)
    assert.ok(raw[0]!.endSec >= 2)
  })

  it('cuantiza a 1/16', () => {
    assert.equal(quantizeBeat(0.05, 0.25), 0)
    assert.equal(quantizeBeat(0.2, 0.25), 0.25)
    const rec = recorderNoteOff(recorderNoteOn(createMidiRecorder(0), 50, 90, 0.11, 0), 50, 0.4, 0)
    const notes = recordedToClipNotes(flushRecorder(rec, 0.4), 0, 120, 0.25)
    assert.equal(notes[0]?.inicio, 0.25)
  })

  it('span mínimo de un beat', () => {
    const span = clipSpanBeats([{ pitch: 60, inicio: 0, duracion: 0.25, velocidad: 90, canal: 0, source: 'recorded' }])
    assert.equal(span.duracion, 1)
  })
})

describe('pad sustain (CC64)', () => {
  it('es no-op tras eliminar Soft Pad Web Audio', () => {
    let s = createPadSustain()
    s = padNoteOn(s, 60)
    const off = padNoteOff(s, 60)
    assert.equal(off.silence, true)
    const down = padPedal(off.next, 127)
    assert.deepEqual(down.release, [])
    const lift = padPedal(down.next, 0)
    assert.deepEqual(lift.release, [])
  })
})

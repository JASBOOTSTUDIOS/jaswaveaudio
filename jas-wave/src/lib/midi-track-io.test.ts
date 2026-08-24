/**
 * Ruteo MIDI por pista.
 * npx tsx --test src/lib/midi-track-io.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  canReceiveMidi,
  midiInputOf,
  midiLiveTargetIds,
  midiNativeLiveTargetIds,
  midiRecordTargetIds,
  parseWinmmPort,
  toMidiRouteTrack,
  trackMatchesMidiDevice,
  type MidiRouteTrack,
} from './midi-track-io'

const kb = 'winmm:0'
const mixer = 'winmm:1'

function track(partial: Partial<MidiRouteTrack> & { id: string }): MidiRouteTrack {
  return { tipo: 'midi', ...partial }
}

describe('midi-track-io', () => {
  it('sin dispositivo asignado no recibe MIDI', () => {
    const t = track({
      id: 'a',
      configuracion: { monitorizarEntrada: true },
    })
    assert.equal(trackMatchesMidiDevice(t, kb), false)
    assert.deepEqual(midiLiveTargetIds([t], kb), [])
  })

  it('monitor off: no thru aunque el dispositivo coincida', () => {
    const t = track({ id: 'a', entrada: kb, configuracion: { monitorizarEntrada: false } })
    assert.deepEqual(midiLiveTargetIds([t], kb), [])
  })

  it('monitor on + dispositivo: thru solo en esa pista', () => {
    const tracks = [
      track({ id: 'a', entrada: kb, configuracion: { monitorizarEntrada: true } }),
      track({ id: 'b', entrada: mixer, configuracion: { monitorizarEntrada: true } }),
      track({ id: 'c', entrada: kb, configuracion: { monitorizarEntrada: false } }),
    ]
    assert.deepEqual(midiLiveTargetIds(tracks, kb), ['a'])
    assert.deepEqual(midiLiveTargetIds(tracks, mixer), ['b'])
  })

  it('grabación por armado aunque el monitor esté off', () => {
    const t = track({ id: 'a', entrada: kb, armada: true, configuracion: { monitorizarEntrada: false } })
    assert.deepEqual(midiRecordTargetIds([t], kb), ['a'])
    assert.deepEqual(midiLiveTargetIds([t], kb), [])
  })

  it('live nativo: solo pistas monitorizadas con entrada', () => {
    const tracks = [
      track({ id: 'a', entrada: kb, configuracion: { monitorizarEntrada: true } }),
      track({ id: 'b', configuracion: { monitorizarEntrada: true } }),
      track({ id: 'c', entrada: mixer, configuracion: { monitorizarEntrada: false } }),
    ]
    assert.deepEqual(midiNativeLiveTargetIds(tracks), ['a'])
  })

  it('parsea puerto WinMM', () => {
    assert.equal(parseWinmmPort('winmm:2'), 2)
    assert.equal(parseWinmmPort('winmm:0'), 0)
    assert.equal(parseWinmmPort('web-xyz'), -1)
  })

  it('entrada ausente (carpeta) no rompe el ruteo', () => {
    const folder = { id: 'f', tipo: 'carpeta' }
    assert.equal(midiInputOf(folder), '')
    const routed = toMidiRouteTrack(folder)
    assert.equal(routed.entrada, '')
    assert.deepEqual(midiLiveTargetIds([routed], kb), [])
  })

  it('pista audio puede recibir MIDI (Reaper-like)', () => {
    assert.equal(canReceiveMidi('audio'), true)
    const t = track({
      id: 'a',
      tipo: 'audio',
      entrada: kb,
      armada: true,
      configuracion: { monitorizarEntrada: true },
    })
    assert.deepEqual(midiLiveTargetIds([t], kb), ['a'])
    assert.deepEqual(midiRecordTargetIds([t], kb), ['a'])
  })
})

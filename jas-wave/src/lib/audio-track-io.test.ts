/**
 * Ruteo de audio por pista.
 * npx tsx --test src/lib/audio-track-io.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  audioDeviceKey,
  audioInputOf,
  audioMonitorTargetIds,
  audioRecordTargetIds,
  groupArmedAudioByDevice,
  isAudioRecordTrack,
  toAudioRouteTrack,
  type AudioRouteTrack,
} from './audio-track-io'

const mic = 'mic-usb'
const iface = 'asio-in-1'

function track(partial: Partial<AudioRouteTrack> & { id: string }): AudioRouteTrack {
  return { tipo: 'audio', ...partial }
}

describe('audio-track-io', () => {
  it('solo pistas audio se pueden grabar', () => {
    assert.equal(isAudioRecordTrack('audio'), true)
    assert.equal(isAudioRecordTrack('midi'), false)
    assert.equal(isAudioRecordTrack('instrumento'), false)
  })

  it('lee dispositivoEntrada y cae a entrada', () => {
    assert.equal(audioInputOf({ id: 'a', dispositivoEntrada: ` ${mic} ` }), mic)
    assert.equal(audioInputOf({ id: 'b', entrada: iface }), iface)
    assert.equal(audioInputOf({ id: 'c' }), '')
  })

  it('grabación: solo armadas (dispositivo vacío = default)', () => {
    const tracks = [
      track({ id: 'a', armada: true, dispositivoEntrada: mic }),
      track({ id: 'b', armada: false, dispositivoEntrada: mic }),
      track({ id: 'c', armada: true }),
    ]
    assert.deepEqual(audioRecordTargetIds(tracks), ['a', 'c'])
  })

  it('monitor: independiente del armado', () => {
    const tracks = [
      track({ id: 'a', armada: true, configuracion: { monitorizarEntrada: false } }),
      track({ id: 'b', armada: false, configuracion: { monitorizarEntrada: true } }),
    ]
    assert.deepEqual(audioMonitorTargetIds(tracks), ['b'])
    assert.deepEqual(audioRecordTargetIds(tracks), ['a'])
  })

  it('agrupa armadas por dispositivo', () => {
    const tracks = [
      track({ id: 'a', armada: true, dispositivoEntrada: mic }),
      track({ id: 'b', armada: true, dispositivoEntrada: mic }),
      track({ id: 'c', armada: true, dispositivoEntrada: iface }),
      track({ id: 'd', armada: true }),
    ]
    const g = groupArmedAudioByDevice(tracks)
    assert.deepEqual(g.get(mic), ['a', 'b'])
    assert.deepEqual(g.get(iface), ['c'])
    assert.deepEqual(g.get(''), ['d'])
  })

  it('carpeta no rompe el ruteo', () => {
    const folder = { id: 'f', tipo: 'carpeta' }
    assert.equal(audioInputOf(folder), '')
    const routed = toAudioRouteTrack(folder)
    assert.equal(routed.dispositivoEntrada, '')
    assert.deepEqual(audioRecordTargetIds([routed]), [])
  })

  it('clave de dispositivo normaliza vacío', () => {
    assert.equal(audioDeviceKey(undefined), '')
    assert.equal(audioDeviceKey('  '), '')
    assert.equal(audioDeviceKey(mic), mic)
  })
})

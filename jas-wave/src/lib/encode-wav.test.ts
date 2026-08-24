/**
 * npx tsx --test src/lib/encode-wav.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { encodeWavPcm16, encodeWavFromAudioBuffer } from './encode-wav'

function ascii(bytes: Uint8Array, start: number, n: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + n))
}

describe('encode-wav', () => {
  it('escribe cabecera RIFF/WAVE PCM 16-bit estéreo', () => {
    const l = new Float32Array([0, 1, -1])
    const r = new Float32Array([0, 0.5, -0.5])
    const wav = encodeWavPcm16([l, r], 48000)
    assert.equal(ascii(wav, 0, 4), 'RIFF')
    assert.equal(ascii(wav, 8, 4), 'WAVE')
    assert.equal(ascii(wav, 12, 4), 'fmt ')
    assert.equal(ascii(wav, 36, 4), 'data')
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    assert.equal(view.getUint16(20, true), 1)
    assert.equal(view.getUint16(22, true), 2)
    assert.equal(view.getUint32(24, true), 48000)
    assert.equal(view.getUint16(34, true), 16)
    assert.equal(view.getUint32(40, true), 3 * 2 * 2)
    assert.equal(wav.length, 44 + 12)
  })

  it('mono vacío sigue siendo WAV válido', () => {
    const wav = encodeWavPcm16([new Float32Array(0)], 44100)
    assert.equal(ascii(wav, 0, 4), 'RIFF')
    assert.equal(wav.length, 44)
  })

  it('encodeWavFromAudioBuffer respeta duración y canales', () => {
    const fake = {
      numberOfChannels: 2,
      length: 100,
      sampleRate: 44100,
      getChannelData: () => new Float32Array(100),
    }
    const wav = encodeWavFromAudioBuffer(fake)
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    assert.equal(view.getUint16(22, true), 2)
    assert.equal(view.getUint32(40, true), 100 * 2 * 2)
    assert.equal(wav.length, 44 + 400)
  })
})

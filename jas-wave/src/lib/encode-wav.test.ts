/**
 * npx tsx --test src/lib/encode-wav.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decodeWav, encodeWav, encodeWavPcm16, encodeWavFromAudioBuffer } from './encode-wav'

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

  it('ida y vuelta en 16, 24 y 32 float', () => {
    const l = new Float32Array([0, 0.5, -0.5, 0.999, -1])
    const r = new Float32Array([0.25, -0.25, 0.125, 0, 0.75])
    for (const bitDepth of [16, 24, 32] as const) {
      const dec = decodeWav(encodeWav([l, r], 44100, { bitDepth, dither: false }))!
      assert.ok(dec, `decodifica ${bitDepth}`)
      assert.equal(dec.bitDepth, bitDepth)
      assert.equal(dec.isFloat, bitDepth === 32)
      assert.equal(dec.sampleRate, 44100)
      // ±2 LSB: el positivo se escala ×(2^n−1) y se lee ÷2^n.
      const tol = bitDepth === 16 ? 2 / 32768 : bitDepth === 24 ? 2 / 8388608 : 0
      for (let i = 0; i < l.length; i++) {
        assert.ok(Math.abs(dec.channels[0]![i]! - l[i]!) <= tol, `L[${i}] @${bitDepth}`)
        assert.ok(Math.abs(dec.channels[1]![i]! - r[i]!) <= tol, `R[${i}] @${bitDepth}`)
      }
    }
  })

  it('32 float conserva overs por encima de 0 dBFS', () => {
    const dec = decodeWav(encodeWav([new Float32Array([1.5, -2])], 48000, { bitDepth: 32 }))!
    assert.equal(dec.channels[0]![0], 1.5)
    assert.equal(dec.channels[0]![1], -2)
  })

  it('el dither es determinista y no cambia la señal más de 1 LSB', () => {
    const x = new Float32Array(2000).fill(0.3)
    const a = encodeWav([x], 48000, { bitDepth: 16, dither: true, seed: 7 })
    const b = encodeWav([x], 48000, { bitDepth: 16, dither: true, seed: 7 })
    assert.deepEqual(a, b)
    const dec = decodeWav(a)!
    for (const v of dec.channels[0]!) assert.ok(Math.abs(v - 0.3) <= 2 / 32768)
  })

  it('decodeWav salta chunks desconocidos antes de data (LIST)', () => {
    const wav = encodeWav([new Float32Array([0.5])], 48000, { bitDepth: 16, dither: false })
    const list = new Uint8Array([0x4c, 0x49, 0x53, 0x54, 4, 0, 0, 0, 1, 2, 3, 4])
    const out = new Uint8Array(wav.length + list.length)
    out.set(wav.subarray(0, 36), 0)
    out.set(list, 36)
    out.set(wav.subarray(36), 36 + list.length)
    const dec = decodeWav(out)!
    assert.ok(Math.abs(dec.channels[0]![0]! - 0.5) < 1e-4)
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

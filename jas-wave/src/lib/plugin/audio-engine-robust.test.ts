/**
 * Tests de robustez del motor (DSP compartido + encoding JWST).
 * Ejecutar: npx tsx --test src/lib/plugin/audio-engine-robust.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  constantPowerGains,
  delayCompensation,
  peakFromByteTimeDomain,
  peakFromTimeDomain,
} from '../../../lib/audio-dsp'
import { encodeStemPacket, encodeTrackGraph, JASWAVE_MIX_DAW_BUS, JASWAVE_MIX_MAGIC } from './track-graph-encoding'

describe('constantPowerGains', () => {
  it('centro ≈ 0.707 / 0.707 (–3 dB)', () => {
    const { gL, gR } = constantPowerGains(1, 0)
    assert.ok(Math.abs(gL - Math.SQRT1_2) < 1e-6)
    assert.ok(Math.abs(gR - Math.SQRT1_2) < 1e-6)
  })
  it('hard left silencia R', () => {
    const { gL, gR } = constantPowerGains(1, -1)
    assert.ok(Math.abs(gL - 1) < 1e-6)
    assert.ok(Math.abs(gR) < 1e-6)
  })
  it('hard right silencia L', () => {
    const { gL, gR } = constantPowerGains(1, 1)
    assert.ok(Math.abs(gL) < 1e-6)
    assert.ok(Math.abs(gR - 1) < 1e-6)
  })
})

describe('delayCompensation', () => {
  it('alinea a la pista más lenta', () => {
    assert.deepEqual(delayCompensation([0, 256, 1024]), [1024, 768, 0])
  })
  it('sin plugins → ceros', () => {
    assert.deepEqual(delayCompensation([0, 0, 0]), [0, 0, 0])
  })
  it('respeta el tope de delay', () => {
    assert.deepEqual(delayCompensation([0, 20000], 16384), [16384, 0])
  })
})

describe('peakFromTimeDomain', () => {
  it('silencio = 0', () => {
    assert.equal(peakFromTimeDomain([0, 0, 0]), 0)
  })
  it('clip = 1', () => {
    assert.equal(peakFromTimeDomain([0, -1, 0.2]), 1)
  })
  it('byte 128 = silencio, 255 ≈ 1', () => {
    assert.equal(peakFromByteTimeDomain([128, 128]), 0)
    assert.ok(peakFromByteTimeDomain([255]) > 0.9)
  })
})

describe('encodeStemPacket', () => {
  it('header JWST little-endian + PCM', () => {
    const pcm = new Float32Array([0.5, -0.25])
    const pkt = encodeStemPacket(3, pcm)
    const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength)
    assert.equal(view.getUint32(0, true), JASWAVE_MIX_MAGIC)
    assert.equal(view.getUint16(4, true), 3)
    assert.equal(view.getUint16(6, true), 1)
    assert.equal(pkt.byteLength, 8 + 8)
  })
  it('bus DAW usa 0xFFFF', () => {
    const pkt = encodeStemPacket(JASWAVE_MIX_DAW_BUS, new Float32Array(4))
    const view = new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength)
    assert.equal(view.getUint16(4, true), 0xffff)
    assert.equal(view.getUint16(6, true), 2)
  })
})

describe('encodeTrackGraph', () => {
  it('serializa idx~gain~pan~muted y roles i/e', () => {
    const enc = encodeTrackGraph({
      tracks: [
        {
          stemIndex: 0,
          gain: 0.8,
          pan: -0.5,
          muted: false,
          slots: [{ slotId: 't1:p1', instrument: true, bypass: false }],
        },
      ],
      master: [{ slotId: 'master:eq', instrument: false, bypass: true }],
    })
    assert.equal(enc, '0~0.8~-0.5~0|t1:p1:i:0||master:eq:e:1')
  })
})

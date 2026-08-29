/**
 * Tests del sintetizador de clips demo (lib/demo-synth.ts).
 * Ejecutar: npx tsx --test src/lib/demo-synth.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { synthDemoSamples } from '../../lib/demo-synth'

const SCHOOLS = ['drums', 'bass', 'chords', 'lead'] as const

function computePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0
  for (let i = 0; i < left.length; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]))
  }
  return peak
}

function computeRms(left: Float32Array, right: Float32Array): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < left.length; i++) {
    sum += left[i] * left[i]
    sum += right[i] * right[i]
    n += 2
  }
  return Math.sqrt(sum / n)
}

function hasBadFloats(left: Float32Array, right: Float32Array): boolean {
  for (let i = 0; i < left.length; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) return true
  }
  return false
}

for (const type of SCHOOLS) {
  describe(`synthDemoSamples(${type})`, () => {
    it('genera audio (RMS > 0) sin NaN/Inf', () => {
      const { left, right } = synthDemoSamples(type, 48000, 2)
      assert.ok(left.length > 0)
      assert.equal(right.length, left.length)
      assert.ok(computeRms(left, right) > 0.001)
      assert.equal(hasBadFloats(left, right), false)
    })

    it('nunca recorta (pico <= 0.92)', () => {
      const { left, right } = synthDemoSamples(type, 48000, 4)
      assert.ok(computePeak(left, right) <= 0.921)
    })

    it('es determinista (misma semilla → mismas muestras)', () => {
      const a = synthDemoSamples(type, 48000, 1)
      const b = synthDemoSamples(type, 48000, 1)
      for (let i = 0; i < a.left.length; i++) {
        assert.equal(a.left[i], b.left[i])
        assert.equal(a.right[i], b.right[i])
      }
    })
  })
}

describe('synthDemoSamples(general)', () => {
  it('empezar/terminar sin pop (primeras y últimas muestras casi cero)', () => {
    const { left, right } = synthDemoSamples('drums', 48000, 2)
    assert.equal(left[0], 0)
    assert.equal(right[0], 0)
    assert.ok(Math.abs(left[left.length - 1]) < 0.05)
    assert.ok(Math.abs(right[right.length - 1]) < 0.05)
  })

  it('las notas de bajo no producen click: valor ≈ 0 en cada frontera de nota', () => {
    const sr = 48000
    const { left } = synthDemoSamples('bass', sr, 2)
    const noteLen = 60 / 134 / 2
    const nIdx = Math.floor(left.length / (noteLen * sr))
    for (let i = 0; i < nIdx; i++) {
      const idx = Math.round(i * noteLen * sr)
      assert.ok(Math.abs(left[idx]) < 0.001, `boundary ${i} not silent`)
    }
  })

  it('synth y lead comparten arpegio (misma duración/longitud)', () => {
    const a = synthDemoSamples('lead', 44100, 2)
    const b = synthDemoSamples('synth', 44100, 2)
    assert.equal(a.left.length, b.left.length)
  })
})
/**
 * npx tsx --test src/lib/plugin/jaswave-fx.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  normalizedFor,
  eqBandParamIds,
  fxDescriptorName,
} from './jaswave-fx-mix'

describe('jaswave-fx-mix', () => {
  it('fxDescriptorName por kind', () => {
    assert.equal(fxDescriptorName('eq'), 'JasWave EQ Parametric Pro')
    assert.equal(fxDescriptorName('comp'), 'JasWave Bus Compressor')
    assert.equal(fxDescriptorName('limiter'), 'JasWave True-Peak Limiter Pro')
    assert.equal(fxDescriptorName('utility'), 'JasWave Utility & Phase Tool')
    assert.equal(fxDescriptorName('deesser'), 'JasWave Smart De-Esser')
  })

  it('eqBandParamIds: bandas 1..8 heredadas (base 1, stride 5) y 9..24 en el bloque nuevo', () => {
    const b1 = eqBandParamIds(1)
    assert.deepEqual(b1, { type: 1, freq: 2, gain: 3, q: 4, on: 5 })
    const b8 = eqBandParamIds(8)
    assert.deepEqual(b8, { type: 36, freq: 37, gain: 38, q: 39, on: 40 })
    const b9 = eqBandParamIds(9)
    assert.deepEqual(b9, { type: 400, freq: 401, gain: 402, q: 403, on: 404 })
    const b24 = eqBandParamIds(24)
    assert.deepEqual(b24, { type: 475, freq: 476, gain: 477, q: 478, on: 479 })
    const b30 = eqBandParamIds(30) // clampa a 24
    assert.deepEqual(b30, b24)
    const b0 = eqBandParamIds(0) // clampa a 1
    assert.deepEqual(b0, { type: 1, freq: 2, gain: 3, q: 4, on: 5 })
  })

  it('normalizedFor EQ: Bypass bool, Output linear, banda freq log', () => {
    assert.equal(normalizedFor('eq', 'Bypass', 0), 0)
    assert.equal(normalizedFor('eq', 'Bypass', 1), 1)
    assert.equal(normalizedFor('eq', 'Output', -24), 0) // min
    assert.equal(normalizedFor('eq', 'Output', 24), 1) // max
    assert.equal(normalizedFor('eq', 'Output', 0), 0.5) // centro
    // Freq log 20..20000; 1000 Hz -> log scale
    const f1000 = normalizedFor('eq', 'Banda 1 Freq', 1000)
    assert.ok(f1000 != null && f1000 >= 0 && f1000 <= 1)
    const f20 = normalizedFor('eq', 'Banda 1 Freq', 20)
    assert.equal(f20, 0)
    const f20000 = normalizedFor('eq', 'Banda 1 Freq', 20000)
    assert.equal(f20000, 1)
  })

  it('normalizedFor Compresor: threshold -60..0, ratio 1..20, GR read-only 40', () => {
    assert.equal(normalizedFor('comp', 'Threshold', -60), 0)
    assert.equal(normalizedFor('comp', 'Threshold', 0), 1)
    assert.equal(normalizedFor('comp', 'Threshold', -30), 0.5)
    assert.equal(normalizedFor('comp', 'Ratio', 1), 0)
    assert.equal(normalizedFor('comp', 'Ratio', 20), 1)
    assert.equal(normalizedFor('comp', 'Ratio', 10.5), 0.5)
    assert.equal(normalizedFor('comp', 'GR', -60), 0)
    assert.equal(normalizedFor('comp', 'GR', 0), 1)
  })

  it('normalizedFor Limitador: ceiling -12..0, inputGain 0..24', () => {
    assert.equal(normalizedFor('limiter', 'Ceiling', -12), 0)
    assert.equal(normalizedFor('limiter', 'Ceiling', 0), 1)
    assert.equal(normalizedFor('limiter', 'Input Gain', 0), 0)
    assert.equal(normalizedFor('limiter', 'Input Gain', 24), 1)
  })

  it('normalizedFor Utility: gain -24..24, width 0..200, balance -1..1', () => {
    assert.equal(normalizedFor('utility', 'Gain', 0), 0.5)
    assert.equal(normalizedFor('utility', 'Width', 100), 0.5)
    assert.equal(normalizedFor('utility', 'Balance', 0), 0.5)
    assert.equal(normalizedFor('utility', 'Balance', -1), 0)
  })

  it('normalizedFor De-esser: freq lineal 3000..12000, modo enum', () => {
    assert.equal(normalizedFor('deesser', 'Freq', 3000), 0)
    assert.equal(normalizedFor('deesser', 'Freq', 12000), 1)
    assert.equal(normalizedFor('deesser', 'Freq', 7500), 0.5)
    assert.equal(normalizedFor('deesser', 'Mode', 'split'), 0)
    assert.equal(normalizedFor('deesser', 'Mode', 'wide'), 1)
  })

  it('normalizedFor devuelve undefined para id/valor inválidos', () => {
    assert.equal(normalizedFor('eq', 9999, 1), undefined)
    assert.equal(normalizedFor('eq', 'Banda 1 Freq', 'no-es-numero'), undefined)
    assert.equal(normalizedFor('comp', 'Ratio', 999), 1) // clampeado
    assert.equal(normalizedFor('comp', 'Ratio', 0), 0) // clampeado
  })
})

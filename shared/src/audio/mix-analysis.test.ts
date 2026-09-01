import { describe, expect, it } from 'vitest'
import {
  buildAudioListenReport,
  measureMixAnalysis,
  measureStereoCorrelation,
  normalizeGainForTarget,
} from './mix-analysis'

describe('mix-analysis', () => {
  it('mide correlación mono ≈ 1 y anti-fase ≈ -1', () => {
    const n = 2048
    const a = new Float32Array(n)
    const b = new Float32Array(n)
    const c = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const x = Math.sin((2 * Math.PI * 440 * i) / 48000)
      a[i] = x
      b[i] = x
      c[i] = -x
    }
    expect(measureStereoCorrelation(a, b)).toBeGreaterThan(0.99)
    expect(measureStereoCorrelation(a, c)).toBeLessThan(-0.99)
  })

  it('produce reporte con bandas y true-peak', () => {
    const n = 48000
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      l[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 48000)
      r[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / 48000 + 0.1)
    }
    const m = measureMixAnalysis([l, r], 48000)
    expect(m.spectrumBands.length).toBeGreaterThanOrEqual(8)
    expect(m.frames).toBe(n)
    expect(m.truePeakDb).toBeLessThan(0)
    const listen = buildAudioListenReport(m, { target: 'streaming', maxTruePeakDb: -1 })
    expect(listen.summary.length).toBeGreaterThan(10)
    const g = normalizeGainForTarget(m, 'peak', -1)
    expect(g).toBeGreaterThan(0)
  })

  it('detecta clipping', () => {
    const n = 1000
    const l = new Float32Array(n)
    l.fill(1)
    const m = measureMixAnalysis([l, l], 48000)
    expect(m.clipping).toBe(true)
    const listen = buildAudioListenReport(m)
    expect(listen.ok).toBe(false)
  })
})

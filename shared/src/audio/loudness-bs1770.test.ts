import { describe, it, expect } from 'vitest'
import { compareLoudnessTarget, measureLoudnessBs1770 } from './loudness-bs1770'

describe('measureLoudnessBs1770', () => {
  it('silence ≈ −70 LUFS', () => {
    const n = 48000
    const z = new Float32Array(n)
    const r = measureLoudnessBs1770([z, z], 48000)
    expect(r.integrated).toBeLessThanOrEqual(-60)
  })

  it('tone has finite integrated and peak', () => {
    const n = 48000 * 4
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / 48000)
      l[i] = s
      r[i] = s
    }
    const m = measureLoudnessBs1770([l, r], 48000)
    expect(Number.isFinite(m.integrated)).toBe(true)
    expect(m.peak).toBeGreaterThan(0.05)
    expect(m.truePeak).toBeGreaterThanOrEqual(m.peak * 0.99)
  })
})

describe('compareLoudnessTarget', () => {
  it('streaming delta', () => {
    const c = compareLoudnessTarget(-16, 'streaming')
    expect(c.targetLufs).toBe(-14)
    expect(Math.abs(c.deltaDb - 2)).toBeLessThan(0.01)
  })
})

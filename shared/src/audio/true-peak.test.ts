import { describe, expect, it } from 'vitest'
import { medirTruePeak } from './true-peak'

describe('medirTruePeak', () => {
  it('inter-sample peak: seno a fs/4 desfasado 45° → TP ≈ +3 dB sobre sample peak', () => {
    const fs = 48000
    const n = fs
    const x = new Float32Array(n)
    // sin(2π·(fs/4)·i/fs + π/4) → muestras en ±0.7071, pico real 1.0 (entre muestras).
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * (fs / 4) * i) / fs + Math.PI / 4)
    let samplePeak = 0
    for (let i = 0; i < n; i++) samplePeak = Math.max(samplePeak, Math.abs(x[i]!))
    expect(samplePeak).toBeCloseTo(Math.SQRT1_2, 3)
    const tp = medirTruePeak([x], samplePeak)
    // TP ≈ 1.0 → ≈ +3.01 dB sobre 0.7071.
    const gananciaDb = 20 * Math.log10(tp / samplePeak)
    expect(gananciaDb).toBeGreaterThan(2.7)
    expect(gananciaDb).toBeLessThan(3.3)
    expect(tp).toBeGreaterThan(samplePeak * 1.01)
  })

  it('seno alineado con muestras → TP ≈ sample peak (sin falso positivo)', () => {
    const fs = 48000
    const n = fs
    const x = new Float32Array(n)
    // fs/8: el pico cae exactamente en una muestra.
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * (fs / 8) * i) / fs)
    let samplePeak = 0
    for (let i = 0; i < n; i++) samplePeak = Math.max(samplePeak, Math.abs(x[i]!))
    expect(samplePeak).toBeCloseTo(1, 3)
    const tp = medirTruePeak([x], samplePeak)
    expect(tp).toBeLessThan(1.01)
    expect(tp).toBeGreaterThan(0.99)
  })

  it('escalado lineal escala el true-peak', () => {
    const fs = 48000
    const n = fs
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * (fs / 4) * i) / fs + Math.PI / 4)
    const tp = medirTruePeak([x])
    // Pico real del seno de amplitud 0.5 (las muestras solo llegan a 0.3536).
    expect(tp).toBeGreaterThan(0.49)
    expect(tp).toBeLessThan(0.52)
  })
})

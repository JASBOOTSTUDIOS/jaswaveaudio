import { describe, expect, it } from 'vitest'
import { medirTransientes } from './transients'

describe('medirTransientes', () => {
  it('caja de ritmos: detecta ≈ 4 onsets/s con ataque corto', () => {
    const fs = 48000
    const segundos = 8
    const n = fs * segundos
    const x = new Float32Array(n)
    // clicks de 2 ms cada 0.25 s (4/s) sobre fondo silencioso.
    const durClick = Math.round(0.002 * fs)
    for (let k = 0; k < 4 * segundos; k++) {
      const ini = Math.round(k * 0.25 * fs)
      for (let i = 0; i < durClick && ini + i < n; i++) {
        x[ini + i] = 0.8 * Math.exp((-5 * i) / durClick) * Math.sin((2 * Math.PI * 3000 * i) / fs)
      }
    }
    const m = medirTransientes([x], fs)
    expect(m.onsets).toBeGreaterThanOrEqual(24)
    expect(m.onsets).toBeLessThanOrEqual(40)
    expect(m.densidadPorSeg).toBeGreaterThan(3)
    expect(m.densidadPorSeg).toBeLessThan(5)
    expect(m.ataqueMedioMs).not.toBeNull()
    expect(m.ataqueMedioMs!).toBeLessThan(10)
  })

  it('seno continuo: sin onsets', () => {
    const fs = 48000
    const n = fs * 4
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / fs)
    const m = medirTransientes([x], fs)
    expect(m.onsets).toBeLessThanOrEqual(2)
    expect(m.ataqueMedioMs).toBeNull()
  })

  it('entrada vacía → valores vacíos', () => {
    const m = medirTransientes([new Float32Array(0)], 48000)
    expect(m.onsets).toBe(0)
    expect(m.densidadPorSeg).toBe(0)
    expect(m.ataqueMedioMs).toBeNull()
  })
})

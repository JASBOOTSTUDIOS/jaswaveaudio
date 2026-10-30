import { describe, expect, it } from 'vitest'
import { medirEstereo } from './stereo'

function seno(hz: number, amp: number, fs: number, segundos: number, fase = 0): Float32Array {
  const n = Math.round(fs * segundos)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs + fase)
  return out
}

describe('medirEstereo', () => {
  it('mono idéntico: correlación 1, ancho 0, sin pérdida mono', () => {
    const x = seno(440, 0.5, 48000, 1)
    const m = medirEstereo(x, x)
    expect(m.correlacion).toBeGreaterThan(0.999)
    expect(m.balanceDb).toBeCloseTo(0, 3)
    expect(m.ancho).toBeLessThan(0.01)
    expect(m.perdidaMonoDb).toBeLessThan(0.05)
    expect(m.energiaSideDb).toBeLessThan(-60)
  })

  it('anti-fase: correlación −1 y 6 dB de pérdida al sumar mono', () => {
    const x = seno(440, 0.5, 48000, 1)
    const m = medirEstereo(x, new Float32Array(x.length).map((_, i) => -x[i]!))
    expect(m.correlacion).toBeLessThan(-0.999)
    expect(m.perdidaMonoDb).toBeGreaterThan(5.9)
  })

  it('balance L/R en dB: L 6 dB por encima de R', () => {
    const l = seno(440, 0.5, 48000, 1)
    const r = seno(440, 0.25, 48000, 1)
    const m = medirEstereo(l, r)
    expect(m.balanceDb).toBeGreaterThan(5.9)
    expect(m.balanceDb).toBeLessThan(6.1)
  })

  it('descorrelacionado (ruido distinto): ancho ≈ 0.5 y pérdida mono ≈ 3 dB', () => {
    const n = 48000
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    let s1 = 1
    let s2 = 987654321
    for (let i = 0; i < n; i++) {
      s1 = (s1 * 1664525 + 1013904223) >>> 0
      s2 = (s2 * 1664525 + 1013904223) >>> 0
      l[i] = (s1 / 0xffffffff) * 2 - 1
      r[i] = (s2 / 0xffffffff) * 2 - 1
    }
    const m = medirEstereo(l, r)
    expect(Math.abs(m.correlacion)).toBeLessThan(0.05)
    expect(m.ancho).toBeGreaterThan(0.45)
    expect(m.ancho).toBeLessThan(0.55)
    expect(m.perdidaMonoDb).toBeGreaterThan(2.8)
    expect(m.perdidaMonoDb).toBeLessThan(3.2)
  })
})

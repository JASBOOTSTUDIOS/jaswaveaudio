import { describe, it, expect } from 'vitest'
import {
  coeficientesKWeighting,
  compareLoudnessTarget,
  esLoudnessTargetName,
  LOUDNESS_PLATFORM_TARGETS,
  LOUDNESS_TARGETS,
  measureLoudnessBs1770,
} from './loudness-bs1770'

/** Genera un seno estéreo (misma señal en L y R) de `segundos` a `hz` con amplitud `amp`. */
function senoEstereo(hz: number, amp: number, sampleRate: number, segundos: number): Float32Array[] {
  const n = Math.round(sampleRate * segundos)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const s = amp * Math.sin((2 * Math.PI * hz * i) / sampleRate)
    l[i] = s
    r[i] = s
  }
  return [l, r]
}

describe('coeficientesKWeighting', () => {
  it('a 48 kHz reproduce la tabla de BS.1770-4', () => {
    const { preFiltro, rlb } = coeficientesKWeighting(48000)
    expect(preFiltro.b0).toBeCloseTo(1.53512485958697, 6)
    expect(preFiltro.b1).toBeCloseTo(-2.69169618940638, 6)
    expect(preFiltro.b2).toBeCloseTo(1.19839281085285, 6)
    expect(preFiltro.a1).toBeCloseTo(-1.69065929318241, 6)
    expect(preFiltro.a2).toBeCloseTo(0.73248077421585, 6)
    expect(rlb.b0).toBe(1)
    expect(rlb.b1).toBe(-2)
    expect(rlb.b2).toBe(1)
    expect(rlb.a1).toBeCloseTo(-1.99004745483398, 6)
    expect(rlb.a2).toBeCloseTo(0.99007225036621, 6)
  })
})

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

  it('señal EBU de prueba: seno 1 kHz a −23 dBFS estéreo → −23.0 LUFS ±0.1', () => {
    const amp = Math.pow(10, -23 / 20)
    const [l, r] = senoEstereo(1000, amp, 48000, 10)
    const m = measureLoudnessBs1770([l, r], 48000)
    expect(m.integrated).toBeGreaterThan(-23.1)
    expect(m.integrated).toBeLessThan(-22.9)
    // Momentary y short-term máximos también ≈ −23 LUFS en señal continua.
    expect(m.momentaryMax ?? m.momentary).toBeGreaterThan(-23.2)
    expect(m.momentaryMax ?? m.momentary).toBeLessThan(-22.8)
    expect(m.shortTermMax ?? m.shortTerm).toBeGreaterThan(-23.2)
    expect(m.shortTermMax ?? m.shortTerm).toBeLessThan(-22.8)
  })

  it('44.1, 48 y 96 kHz dan el mismo LUFS para la misma señal (±0.15 LU)', () => {
    const amp = Math.pow(10, -23 / 20)
    const lufts: number[] = []
    for (const fs of [44100, 48000, 96000]) {
      const [l, r] = senoEstereo(1000, amp, fs, 8)
      lufts.push(measureLoudnessBs1770([l, r], fs).integrated)
    }
    for (const v of lufts) {
      expect(v).toBeGreaterThan(-23.15)
      expect(v).toBeLessThan(-22.85)
    }
    const spread = Math.max(...lufts) - Math.min(...lufts)
    expect(spread).toBeLessThan(0.15)
  })

  it('expone series temporales momentary/short-term a 10 Hz', () => {
    const [l, r] = senoEstereo(1000, Math.pow(10, -23 / 20), 48000, 6)
    const m = measureLoudnessBs1770([l, r], 48000)
    // 6 s: momentary (bloque 0.4 s) → ≈ 57 valores; short-term (3 s) → ≈ 31.
    expect(m.serieMomentary?.length).toBeGreaterThan(50)
    expect(m.serieMomentary?.length).toBeLessThan(62)
    expect(m.serieShortTerm?.length).toBeGreaterThan(25)
    expect(m.serieShortTerm?.length).toBeLessThan(36)
    expect(m.pasoSerieSeg).toBeCloseTo(0.1, 3)
    // En señal continua todas las ventanas son iguales.
    for (const v of m.serieMomentary ?? []) expect(Math.abs(v - m.integrated)).toBeLessThan(0.3)
  })

  it('LRA EBU Tech 3342 ≈ diferencia de nivel entre secciones (10 LU ±1.5)', () => {
    const fs = 48000
    const segundos = 16
    const n = fs * segundos
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    // 4 s a −20 LUFS (amp 0.1) y 4 s a −30 LUFS (amp 0.0316), alternos, con rampas de 5 ms.
    const rampa = Math.round(0.005 * fs)
    for (let i = 0; i < n; i++) {
      const seccion = Math.floor(i / (4 * fs))
      const dentro = i - seccion * 4 * fs
      const ampFuerte = seccion % 2 === 0
      let amp = ampFuerte ? 0.1 : 0.0316
      if (dentro < rampa) amp *= dentro / rampa
      else if (dentro > 4 * fs - rampa) amp *= (4 * fs - dentro) / rampa
      const s = amp * Math.sin((2 * Math.PI * 1000 * i) / fs)
      l[i] = s
      r[i] = s
    }
    const m = measureLoudnessBs1770([l, r], fs)
    expect(m.rangoDinamico).toBeGreaterThan(8)
    expect(m.rangoDinamico).toBeLessThan(12)
    expect(m.shortTermMax ?? -100).toBeCloseTo(-20, 0)
  })
})

describe('objetivos por plataforma', () => {
  it('tienen los valores documentados', () => {
    expect(LOUDNESS_PLATFORM_TARGETS.spotify).toEqual({ lufs: -14, truePeakDb: -1, descripcion: expect.any(String) })
    expect(LOUDNESS_PLATFORM_TARGETS.apple.lufs).toBe(-16)
    expect(LOUDNESS_PLATFORM_TARGETS.youtube.lufs).toBe(-14)
    expect(LOUDNESS_PLATFORM_TARGETS.amazon).toMatchObject({ lufs: -14, truePeakDb: -2 })
    expect(LOUDNESS_PLATFORM_TARGETS.club).toMatchObject({ lufs: -8, truePeakDb: -0.3 })
    expect(LOUDNESS_PLATFORM_TARGETS.broadcast).toMatchObject({ lufs: -23, truePeakDb: -1 })
    expect(LOUDNESS_PLATFORM_TARGETS.cd).toMatchObject({ lufs: -9, truePeakDb: -0.3 })
    // Alias histórico.
    expect(LOUDNESS_TARGETS.streaming).toBe(-14)
    expect(esLoudnessTargetName('apple')).toBe(true)
    expect(esLoudnessTargetName('nope')).toBe(false)
  })
})

describe('compareLoudnessTarget', () => {
  it('streaming delta', () => {
    const c = compareLoudnessTarget(-16, 'streaming')
    expect(c.targetLufs).toBe(-14)
    expect(Math.abs(c.deltaDb - 2)).toBeLessThan(0.01)
  })

  it('avisa si la ganancia superaría el techo de true-peak', () => {
    // −18 LUFS → +4 dB hacia spotify (−14); TP −2.5 + 4 = +1.5 dBTP > techo −1.
    const c = compareLoudnessTarget(-18, 'spotify', -2.5)
    expect(c.targetTruePeakDb).toBe(-1)
    expect(c.truePeakTrasGananciaDb).toBeCloseTo(1.5, 3)
    expect(c.suggestion).toContain('limitador')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildAudioListenReport,
  compactarInformeAudio,
  measureMixAnalysis,
  measureStereoCorrelation,
  normalizeGainForTarget,
} from './mix-analysis'

describe('mix-analysis', () => {
  it('seno 1 kHz −20 dBFS: peak −20.0 dB, RMS −23.01 dB, crest 3.01 dB', () => {
    const fs = 48000
    const n = fs * 4
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const s = 0.1 * Math.sin((2 * Math.PI * 1000 * i) / fs)
      l[i] = s
      r[i] = s
    }
    const m = measureMixAnalysis([l, r], fs)
    expect(m.peakDb).toBeGreaterThan(-20.01)
    expect(m.peakDb).toBeLessThan(-19.99)
    expect(m.rmsDb!).toBeGreaterThan(-23.1)
    expect(m.rmsDb!).toBeLessThan(-22.9)
    expect(m.crestFactorDb).toBeGreaterThan(2.9)
    expect(m.crestFactorDb).toBeLessThan(3.1)
    // PLR = TP − integrated (seno pico 0.1 estéreo → ≈ −20 LUFS, TP ≈ −20 dBTP).
    expect(m.plrDb!).toBeGreaterThan(-1)
    expect(m.plrDb!).toBeLessThan(1)
    // Ventanas de 1 s: RMS por ventana constante.
    const dyn = m.dinamicaVentanas!
    expect(dyn.rmsDb.length).toBe(4)
    for (const v of dyn.rmsDb) expect(Math.abs(v - m.rmsDb!)).toBeLessThan(0.2)
    expect(dyn.crestMedianaDb).toBeGreaterThan(2.9)
    expect(dyn.crestMedianaDb).toBeLessThan(3.1)
  })

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

  it('incluye métricas nuevas opcionales (31 bandas, agregados, estéreo, transientes)', () => {
    const fs = 48000
    const n = fs * 3
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      l[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / fs)
      r[i] = 0.3 * Math.sin((2 * Math.PI * 300 * i) / fs + 0.5)
    }
    const m = measureMixAnalysis([l, r], fs)
    expect(m.spectrumBands.length).toBe(31)
    expect(m.bandasAgregadas?.map((b) => b.label)).toEqual([
      'sub',
      'low',
      'lowmid',
      'mid',
      'highmid',
      'high',
    ])
    expect(m.estereo?.porBanda?.length).toBe(6)
    expect(m.estereo?.correlacion).toBeGreaterThan(-1)
    expect(m.transientes?.ataqueMedioMs).toBeNull() // seno continuo sin onsets
    expect(m.loudness.serieMomentary?.length).toBeGreaterThan(20)
    // buildAudioListenReport expone campos nuevos opcionales sin romper los antiguos.
    const listen = buildAudioListenReport(m, { target: 'spotify' })
    expect(listen.targetLufs).toBe(-14)
    expect(listen.targetTruePeakDb).toBe(-1)
    expect(Array.isArray(listen.advertencias)).toBe(true)
    expect(listen.summary).toContain('LUFS')
    // compactarInformeAudio elimina series/largas sin tocar lo demás.
    const compacto = compactarInformeAudio(listen)
    expect(compacto.loudness.serieMomentary).toBeUndefined()
    expect(compacto.loudness.serieShortTerm).toBeUndefined()
    expect(compacto.dinamicaVentanas?.rmsDb.length).toBe(0)
    expect(compacto.loudness.integrated).toBe(listen.loudness.integrated)
    expect(compacto.spectrumBands.length).toBe(31)
  })
})

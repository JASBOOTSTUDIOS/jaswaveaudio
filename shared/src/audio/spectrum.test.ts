import { describe, expect, it } from 'vitest'
import { bandasTercioOctava, medirEspectroWelch, densidadesWelch, espectroDesdeDensidades } from './spectrum'

/** PRNG determinista (mulberry32) para ruido reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ruido rosa (Paul Kellet, método refinado) normalizado a RMS ≈ 0.1. */
function ruidoRosa(sampleRate: number, segundos: number, seed = 12345): Float32Array {
  const rnd = mulberry32(seed)
  const n = Math.round(sampleRate * segundos)
  const out = new Float32Array(n)
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  let suma = 0
  for (let i = 0; i < n; i++) {
    const w = rnd() * 2 - 1
    b0 = 0.99886 * b0 + w * 0.0555179
    b1 = 0.99332 * b1 + w * 0.0750759
    b2 = 0.969 * b2 + w * 0.153852
    b3 = 0.8665 * b3 + w * 0.3104856
    b4 = 0.55 * b4 + w * 0.5329522
    b5 = -0.7616 * b5 - w * 0.016898
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362
    b6 = w * 0.115926
    out[i] = p
    suma += p * p
  }
  const rms = Math.sqrt(suma / n)
  const g = 0.1 / Math.max(1e-9, rms)
  for (let i = 0; i < n; i++) out[i] *= g
  return out
}

describe('bandasTercioOctava', () => {
  it('31 bandas ISO de 20 Hz a 20 kHz con bordes de octava exactos', () => {
    const b = bandasTercioOctava()
    expect(b.length).toBe(31)
    expect(b[0]!.centro).toBe(20)
    expect(b[17]!.centro).toBe(1000)
    expect(b[30]!.centro).toBe(20000)
    for (const banda of b) {
      // Bordes ISO: fc·10^(±1/20) → razón 10^(1/10) = 2^(1/3) (1/3 de octava).
      expect(banda.hiHz / banda.loHz).toBeCloseTo(Math.pow(10, 1 / 10), 6)
      expect(banda.centro).toBeGreaterThan(banda.loHz)
      expect(banda.centro).toBeLessThan(banda.hiHz)
      expect(Math.sqrt(banda.loHz * banda.hiHz) / banda.centro).toBeGreaterThan(0.95)
      expect(Math.sqrt(banda.loHz * banda.hiHz) / banda.centro).toBeLessThan(1.05)
    }
  })
})

describe('medirEspectroWelch', () => {
  it('seno 1 kHz a 0 dBFS pico cae en la banda 1k con −3.0 dB de potencia', () => {
    const fs = 48000
    const n = fs * 4
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / fs)
    const e = medirEspectroWelch([x], fs)
    const banda1k = e.tercios.find((b) => b.hzCenter === 1000)!
    // Potencia de un seno pico 1.0 = −3.01 dB RMS.
    expect(banda1k.db).toBeGreaterThan(-3.6)
    expect(banda1k.db).toBeLessThan(-2.5)
    // Las bandas lejanas están mucho por debajo.
    const sub = e.tercios.find((b) => b.hzCenter === 40)!
    expect(sub.db).toBeLessThan(banda1k.db - 40)
  })

  it('ruido rosa → espectro plano en 1/3 de octava (±1 dB, 40 Hz–16 kHz)', () => {
    const fs = 48000
    const x = ruidoRosa(fs, 20)
    const e = medirEspectroWelch([x], fs)
    const bandas = e.tercios.filter((b) => b.hzCenter >= 40 && b.hzCenter <= 16000 && b.hiHz! < fs / 2)
    expect(bandas.length).toBeGreaterThanOrEqual(24)
    const dbs = bandas.map((b) => b.db)
    const media = dbs.reduce((a, b) => a + b, 0) / dbs.length
    for (const db of dbs) {
      expect(Math.abs(db - media)).toBeLessThan(1)
    }
  })

  it('L y R idénticos → correlación 1 en todas las bandas; anti-fase → −1', () => {
    const fs = 48000
    const x = ruidoRosa(fs, 6)
    const inv = new Float32Array(x.length)
    for (let i = 0; i < x.length; i++) inv[i] = -x[i]!
    const mismo = espectroDesdeDensidades(densidadesWelch(x, x, fs), fs)
    const anti = espectroDesdeDensidades(densidadesWelch(x, inv, fs), fs)
    for (const b of mismo.estereoPorBanda) {
      if (b.hiHz > fs / 2) continue
      expect(b.correlacion).toBeGreaterThan(0.999)
      expect(b.ancho).toBeLessThan(0.01)
      expect(b.perdidaMonoDb).toBeLessThan(0.05)
    }
    for (const b of anti.estereoPorBanda) {
      if (b.hiHz > fs / 2 || b.loHz >= fs / 2) continue
      expect(b.correlacion).toBeLessThan(-0.999)
      expect(b.perdidaMonoDb).toBeGreaterThan(3)
    }
  })
})

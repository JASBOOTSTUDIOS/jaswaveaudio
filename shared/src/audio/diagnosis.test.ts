import { describe, expect, it } from 'vitest'
import {
  compararConReferencia,
  detectarEnmascaramiento,
  diagnosticarMezcla,
  medidaDesdeAnalisis,
  nivelMedioEnRango,
  type MedidaMezcla,
  type MedidaPista,
} from './diagnosis'
import { CENTROS_TERCIO_OCTAVA, type BandEnergy } from './spectrum'
import { measureMixAnalysis } from './mix-analysis'

/** Bandas de 1/3 de octava sintéticas: base plana +ocatavas concretas. */
function bandas(overrides: Record<number, number> = {}, base = -20): BandEnergy[] {
  return CENTROS_TERCIO_OCTAVA.map((hz) => ({
    hzCenter: hz,
    label: String(hz),
    db: overrides[hz] ?? base,
    loHz: hz * 0.89,
    hiHz: hz * 1.12,
  }))
}

function medida(trackId: string, over: Partial<MedidaPista> = {}): MedidaPista {
  return {
    trackId,
    nombre: trackId,
    integrated: -14,
    truePeakDb: -1,
    peakDb: -1,
    rmsDb: -20,
    crestFactorDb: 12,
    bandas: bandas(),
    ...over,
  }
}

function mezcla(master: MedidaPista, pistas: MedidaPista[] = []): MedidaMezcla {
  return { pistas, master, suma: master }
}

function reglas(hallazgos: { regla: string }[]): string[] {
  return hallazgos.map((h) => h.regla)
}

describe('diagnóstico de mezcla', () => {
  it('detecta barro en 200–500 Hz con evidencia numérica', () => {
    const bandasBarro = bandas({ 315: -6, 400: -6 })
    const m = mezcla(medida('master', { bandas: bandasBarro }), [medida('caja', { bandas: bandasBarro })])
    const d = diagnosticarMezcla(m)
    const barro = d.find((x) => x.regla === 'barro')
    expect(barro).toBeDefined()
    expect(barro!.severidad).toBe('critico')
    expect(barro!.pistas).toContain('caja')
    expect(barro!.evidencia).toMatch(/dB/)
    expect(barro!.sugerencias.length).toBeGreaterThan(0)
  })

  it('detecta aspereza con pico puntual 2–5 kHz', () => {
    const bandasAspereza = bandas({ 3150: -6 })
    const m = mezcla(medida('master', { bandas: bandasAspereza }), [medida('voz', { bandas: bandasAspereza })])
    const aspereza = diagnosticarMezcla(m).find((x) => x.regla === 'aspereza')
    expect(aspereza).toBeDefined()
    expect(aspereza!.problema).toMatch(/3150/)
    expect(aspereza!.pistas).toContain('voz')
  })

  it('detecta sibilancia con pico 5–9 kHz', () => {
    const m = mezcla(medida('master', { bandas: bandas({ 6300: -6 }) }))
    const sibilancia = diagnosticarMezcla(m).find((x) => x.regla === 'sibilancia')
    expect(sibilancia).toBeDefined()
    expect(sibilancia!.problema).toMatch(/6300/)
  })

  it('detecta falta de sub cuando 20–60 Hz queda por debajo de 60–250 Hz', () => {
    const bandasSinSub: Record<number, number> = {}
    for (const hz of [20, 25, 31.5, 40, 50]) bandasSinSub[hz] = -45
    const m = mezcla(medida('master', { bandas: bandas(bandasSinSub) }))
    const falta = diagnosticarMezcla(m).find((x) => x.regla === 'falta-sub')
    expect(falta).toBeDefined()
    expect(falta!.severidad).toBe('critico')
  })

  it('detecta exceso de sub cuando 20–60 Hz domina', () => {
    const bandasConSub: Record<number, number> = {}
    for (const hz of [20, 25, 31.5, 40, 50]) bandasConSub[hz] = -4
    const m = mezcla(medida('master', { bandas: bandas(bandasConSub) }))
    const exceso = diagnosticarMezcla(m).find((x) => x.regla === 'exceso-sub')
    expect(exceso).toBeDefined()
    expect(exceso!.severidad).toBe('critico')
  })

  it('detecta contrafase, pérdida mono y desequilibrio L/R', () => {
    const stereo = {
      correlacion: -0.8,
      balanceDb: 3.2,
      ancho: 0.6,
      energiaMidDb: -12,
      energiaSideDb: -9,
      perdidaMonoDb: 5,
    }
    const m = mezcla(medida('master', { stereo }))
    const d = diagnosticarMezcla(m)
    expect(reglas(d)).toContain('contrafase')
    expect(reglas(d)).toContain('perdida-mono')
    expect(reglas(d)).toContain('desequilibrio-lr')
  })

  it('detecta sobre-compresión, falta de dinámica, clipping y headroom', () => {
    const m = mezcla(
      medida('master', {
        plrDb: 4,
        crestFactorDb: 2.5,
        lraDb: 1.5,
        clipping: true,
        clippingSamples: 120,
        truePeakDb: -0.4,
      }),
    )
    const d = diagnosticarMezcla(m)
    expect(reglas(d)).toContain('sobre-compresion')
    expect(reglas(d)).toContain('crest-bajo')
    expect(reglas(d)).toContain('falta-dinamica')
    expect(reglas(d)).toContain('clipping')
    expect(reglas(d)).toContain('headroom')
  })

  it('ordena los hallazgos por severidad (crítico → aviso → info)', () => {
    const m = mezcla(
      medida('master', {
        plrDb: 4,
        stereo: {
          correlacion: -0.8,
          balanceDb: 0,
          ancho: 0.5,
          energiaMidDb: -12,
          energiaSideDb: -10,
          perdidaMonoDb: 4,
        },
      }),
    )
    const d = diagnosticarMezcla(m)
    const orden = d.map((x) => (x.severidad === 'critico' ? 0 : x.severidad === 'aviso' ? 1 : 2))
    expect([...orden].sort((a, b) => a - b)).toEqual(orden)
    expect(d.length).toBeGreaterThan(1)
  })
})

describe('enmascaramiento', () => {
  it('marca como crítico el solapamiento kick/bajo', () => {
    const bajo = medida('bajo', { bandas: bandas({ 50: -10 }, -40) })
    const kick = medida('kick', { bandas: bandas({ 50: -2 }, -40) })
    const matriz = detectarEnmascaramiento([bajo, kick])
    expect(matriz.pares.length).toBe(1)
    expect(matriz.criticos.length).toBe(1)
    expect(matriz.criticos[0]!.rangoCritico).toBe('kick/bajo')
    expect(matriz.criticos[0]!.bandas[0]!.diferenciaDb).toBe(8)
  })

  it('no reporta solapamiento cuando la diferencia es menor que el umbral', () => {
    const bajo = medida('bajo', { bandas: bandas({ 50: -10 }, -40) })
    const kick = medida('kick', { bandas: bandas({ 50: -9 }, -40) })
    const matriz = detectarEnmascaramiento([bajo, kick])
    expect(matriz.pares.length).toBe(0)
  })

  it('genera un diagnóstico de enmascaramiento con las dos pistas implicadas', () => {
    const bajo = medida('bajo', { bandas: bandas({ 50: -10 }, -40) })
    const kick = medida('kick', { bandas: bandas({ 50: -2 }, -40) })
    const d = diagnosticarMezcla(mezcla(medida('master'), [bajo, kick]))
    const enm = d.find((x) => x.regla === 'enmascaramiento')
    expect(enm).toBeDefined()
    expect(enm!.pistas.sort()).toEqual(['bajo', 'kick'])
  })
})

describe('adaptador A7a → medida', () => {
  it('mapea un informe real de A7a', () => {
    const fs = 48000
    const n = fs * 3
    const x = new Float32Array(n)
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 1000 * i) / fs) * 0.5
    const analysis = measureMixAnalysis([x, x], fs)
    const m = medidaDesdeAnalisis('t1', 'Pista 1', analysis)
    expect(m.bandas.length).toBe(31)
    expect(Number.isFinite(m.integrated)).toBe(true)
    expect(m.truePeakDb).toBeCloseTo(analysis.truePeakDb, 6)
    expect(m.crestFactorDb).toBeCloseTo(analysis.crestFactorDb, 6)
    expect(m.stereo?.correlacion).toBeCloseTo(1, 3)
  })

  it('el nivel medio por rango devuelve -140 si no hay bandas', () => {
    expect(nivelMedioEnRango([], 100, 200)).toBe(-140)
  })
})

describe('comparación con referencia', () => {
  it('calcula la diferencia de loudness y la ganancia de igualación', () => {
    const ref = medida('ref', { integrated: -14 })
    const act = medida('mezcla', { integrated: -20 })
    const cmp = compararConReferencia(ref, act)
    expect(cmp.lufs.diferenciaDb).toBe(-6)
    expect(cmp.gananciaIgualacionDb).toBe(6)
    expect(cmp.diferenciasClave.join(' ')).toMatch(/Loudness/)
  })

  it('lista las bandas que más difieren', () => {
    const ref = medida('ref', { bandas: bandas() })
    const act = medida('mezcla', { bandas: bandas({ 1000: -6 }) })
    const cmp = compararConReferencia(ref, act)
    const mil = cmp.bandas.find((b) => b.hzCenter === 1000)!
    expect(mil.diferenciaDb).toBe(14)
    expect(cmp.diferenciasClave.join(' ')).toMatch(/1000/)
  })
})

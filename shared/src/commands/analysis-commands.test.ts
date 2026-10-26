import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  crearComandoAnalysisDiagnose,
  crearComandoAnalysisDynamics,
  crearComandoAnalysisLoudness,
  crearComandoAnalysisMasking,
  crearComandoAnalysisMix,
  crearComandoAnalysisReference,
  crearComandoAnalysisSection,
  crearComandoAnalysisTrack,
  crearComandoAnalysisAudioLens,
  crearComandoAnalysisVoiceToDrums,
  resolverRango,
} from '../commands/analysis-commands'
import { registrarProveedorAnalisis, type AnalisisProyecto, type RequerimientoAnalisis } from '../audio/analysis-provider'
import { crearEstadoInicial } from '../state/estado-inicial'
import type { DAWState } from '../types/state'
import type { MedidaPista } from '../audio/diagnosis'
import { CENTROS_TERCIO_OCTAVA, type BandEnergy } from '../audio/spectrum'

function bandas(base = -20, over: Record<number, number> = {}): BandEnergy[] {
  return CENTROS_TERCIO_OCTAVA.map((hz) => ({
    hzCenter: hz,
    label: String(hz),
    db: over[hz] ?? base,
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
    plrDb: 11,
    lraDb: 8,
    bandas: bandas(),
    ...over,
  }
}

function analisisFake(over: Partial<AnalisisProyecto> = {}): AnalisisProyecto {
  const bajo = medida('bajo')
  const kick = medida('kick', { integrated: -10 })
  return {
    revision: 'rev1',
    rango: { inicioSeg: 0, finSeg: 8 },
    pistas: [bajo, kick],
    master: medida('master'),
    suma: medida('suma'),
    metadatos: {
      backend: 'fake',
      tap: 'post',
      bypassMaster: false,
      sampleRate: 48000,
      duracionSeg: 8,
    },
    ...over,
  }
}

function estadoConProyecto(): DAWState {
  const base = crearEstadoInicial() as DAWState
  return {
    ...base,
    project: {
      ...base.project,
      bpm: { ...base.project.bpm, valor: 120 },
      marcadores: [
        { id: 'm1', nombre: 'Coro', tiempo: 16, color: '#fff', seleccionado: false, tipo: 'marcador' },
        { id: 'm2', nombre: 'Region', tiempo: 32, color: '#fff', seleccionado: false, tipo: 'region', regionInicio: 32, regionFin: 64 },
      ],
    },
  }
}

describe('comandos analysis.* (A7b)', () => {
  let estado: DAWState
  let pedidos: RequerimientoAnalisis[] = []

  beforeEach(() => {
    estado = estadoConProyecto()
    pedidos = []
    registrarProveedorAnalisis(async (req) => {
      pedidos.push(req)
      return analisisFake({ revision: req.revision, rango: req.rango ?? { inicioSeg: 0, finSeg: 8 } })
    })
  })

  afterEach(() => {
    registrarProveedorAnalisis(null)
  })

  it('analysis.mix devuelve pistas, master y suma sin mutar el estado', async () => {
    const cmd = crearComandoAnalysisMix()
    const r = await cmd.handler(estado, {})
    expect(r.state).toBe(estado)
    const res = r.result as { pistas: MedidaPista[]; master: MedidaPista }
    expect(res.pistas.map((p) => p.trackId)).toEqual(['bajo', 'kick'])
    expect(res.master.trackId).toBe('master')
  })

  it('analysis.track mide solo la pista pedida', async () => {
    const cmd = crearComandoAnalysisTrack()
    const r = await cmd.handler(estado, { trackId: 'kick' })
    expect((r.result as MedidaPista).trackId).toBe('kick')
    expect(pedidos[0]!.pistas).toEqual(['kick'])
  })

  it('analysis.track avisa si la pista no tiene audio en el rango', async () => {
    const cmd = crearComandoAnalysisTrack()
    await expect(cmd.handler(estado, { trackId: 'no-existe' })).rejects.toThrow(/no tiene audio/)
  })

  it('analysis.masking devuelve la matriz de solapamientos', async () => {
    const cmd = crearComandoAnalysisMasking()
    const r = await cmd.handler(estado, {})
    expect((r.result as { pares: unknown[] }).pares).toEqual([])
  })

  it('analysis.dynamics devuelve crest, PLR y LRA por pista y master', async () => {
    const cmd = crearComandoAnalysisDynamics()
    const r = await cmd.handler(estado, {})
    const res = r.result as { pistas: Array<{ trackId: string; crestFactorDb: number }>; master: { crestFactorDb: number } }
    expect(res.pistas.map((p) => p.trackId)).toEqual(['bajo', 'kick'])
    expect(res.master.crestFactorDb).toBe(12)
  })

  it('analysis.diagnose devuelve hallazgos y resumen', async () => {
    const cmd = crearComandoAnalysisDiagnose()
    const r = await cmd.handler(estado, {})
    const res = r.result as { diagnostico: unknown[]; resumen: { criticos: number } }
    expect(Array.isArray(res.diagnostico)).toBe(true)
    expect(typeof res.resumen.criticos).toBe('number')
  })

  it('analysis.section resuelve el rango a partir del marcador', async () => {
    const cmd = crearComandoAnalysisSection()
    const r = await cmd.handler(estado, { marcador: 'Region' })
    expect((r.result as { rango: { inicioSeg: number; finSeg: number } }).rango).toEqual({
      inicioSeg: 16,
      finSeg: 32,
    })
  })

  it('analysis.reference compara la referencia con la mezcla', async () => {
    const cmd = crearComandoAnalysisReference()
    const r = await cmd.handler(estado, { trackId: 'bajo' })
    const res = r.result as { gananciaIgualacionDb: number; lufs: { diferenciaDb: number } }
    expect(res.gananciaIgualacionDb).toBe(0)
    expect(res.lufs.diferenciaDb).toBe(0)
  })

  it('analysis.loudness con source play usa el motor de análisis', async () => {
    const cmd = crearComandoAnalysisLoudness()
    const r = await cmd.handler(estado, { source: 'play' })
    const res = r.result as { source: string; integrated: number }
    expect(res.source).toBe('play')
    expect(res.integrated).toBe(-14)
  })

  it('sin motor de análisis los comandos fallan con un mensaje claro', async () => {
    registrarProveedorAnalisis(null)
    const cmd = crearComandoAnalysisMix()
    await expect(cmd.handler(estado, {})).rejects.toThrow(/motor de análisis/)
  })
})

describe('resolución de rango', () => {
  const estado = estadoConProyecto()

  it('usa el rango explícito en segundos', () => {
    expect(resolverRango(estado, { inicioSeg: 2, finSeg: 5 })).toEqual({ inicioSeg: 2, finSeg: 5 })
  })

  it('usa un marcador hasta el siguiente', () => {
    const rango = resolverRango(estado, { marcador: 'Coro' })
    expect(rango.inicioSeg).toBe(8)
    expect(rango.finSeg).toBe(16)
  })

  it('usa los bordes de una región', () => {
    expect(resolverRango(estado, { marcador: 'Region' })).toEqual({ inicioSeg: 16, finSeg: 32 })
  })

  it('sin rango usa el proyecto entero', () => {
    expect(resolverRango(estado, {})).toEqual({ inicioSeg: 0, finSeg: 0 })
  })
})

describe('comandos AudioLens y VoiceToDrums', () => {
  const estado = crearEstadoInicial()

  it('analysis.audioLens procesa muestras de audio y devuelve informe descriptivo', async () => {
    const cmd = crearComandoAnalysisAudioLens()
    // 0.5s de audio sintético
    const sr = 44100
    const audioData = Array.from({ length: Math.floor(0.5 * sr) }, (_, i) =>
      Math.sin((2 * Math.PI * 440 * i) / sr)
    )

    const res = await cmd.handler(estado, { audioData, sampleRate: sr, bpm: 120 })
    expect(res.result).toBeDefined()
    expect(res.result.resumenParaIA).toContain('REPORTE JASWAVE AUDIOLENS')
    expect(res.result.tonalidad).toBeDefined()
    expect(res.result.bpmEstimado).toBe(120)
  })

  it('analysis.voiceToDrums convierte beatbox en notas MIDI y puede crear la pista', async () => {
    const cmd = crearComandoAnalysisVoiceToDrums()
    const sr = 44100
    const audioData = new Array(Math.floor(1.0 * sr)).fill(0)
    // Agregamos un golpe grave de kick al inicio
    for (let i = 0; i < 2000; i++) {
      audioData[i] = 0.9 * Math.sin((2 * Math.PI * 65 * i) / sr)
    }

    const res = await cmd.handler(estado, {
      audioData,
      sampleRate: sr,
      bpm: 120,
      cuantizar: '1/16',
      crearPista: true,
      nombrePista: 'Batería Beatbox Test',
    })

    expect(res.result.totalNotas).toBeGreaterThan(0)
    expect(res.state.project.tracks.some((t) => t.nombre === 'Batería Beatbox Test')).toBe(true)
    const pistaCreada = res.state.project.tracks.find((t) => t.nombre === 'Batería Beatbox Test')
    expect(pistaCreada?.clips.length).toBe(1)
    expect(pistaCreada?.clips[0]?.tipo).toBe('midi')
  })
})


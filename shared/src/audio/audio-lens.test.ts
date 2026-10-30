import { describe, expect, it } from 'vitest'
import {
  calcularCromagrama,
  clasificarPercusionVocal,
  estimarTonalidad,
  generarDescripcionMusicalAudio,
} from './audio-lens'

describe('audio-lens: Análisis musical y Beatbox a MIDI', () => {
  const sampleRate = 44100

  it('detecta correctamente la clase de tono A4 (440 Hz) en el cromagrama', () => {
    const duracionSeg = 0.5
    const n = Math.floor(duracionSeg * sampleRate)
    const audio = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      audio[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    }

    const { cromas } = calcularCromagrama(audio, sampleRate)
    expect(cromas.length).toBeGreaterThan(0)

    // PitchClass 9 corresponde a 'A'
    const primerCroma = cromas[0]!
    let maxPc = 0
    let maxVal = -1
    for (let pc = 0; pc < 12; pc++) {
      if (primerCroma[pc]! > maxVal) {
        maxVal = primerCroma[pc]!
        maxPc = pc
      }
    }
    expect(maxPc).toBe(9) // 'A'
  })

  it('estima la tonalidad de C mayor con una tríada sintética C-E-G', () => {
    const duracionSeg = 0.6
    const n = Math.floor(duracionSeg * sampleRate)
    const audio = new Float64Array(n)
    const fC = 261.63
    const fE = 329.63
    const fG = 392.0

    for (let i = 0; i < n; i++) {
      audio[i] =
        0.33 * Math.sin((2 * Math.PI * fC * i) / sampleRate) +
        0.33 * Math.sin((2 * Math.PI * fE * i) / sampleRate) +
        0.33 * Math.sin((2 * Math.PI * fG * i) / sampleRate)
    }

    const { cromas } = calcularCromagrama(audio, sampleRate)
    const tonalidad = estimarTonalidad(cromas)
    expect(tonalidad.raiz).toBe('C')
    expect(tonalidad.escala).toBe('mayor')
    expect(tonalidad.confianza).toBeGreaterThan(0.4)
  })

  it('clasifica patrones de beatbox sintetizados (Kick, Snare, Hi-Hat) y detecta pausas', () => {
    // 2 segundos totales a 44100 Hz
    const duracionSeg = 2.0
    const n = Math.floor(duracionSeg * sampleRate)
    const audio = new Float64Array(n)

    // 1. Kick en t = 0.1s (seno decayendo a 60 Hz)
    const offsetKick = Math.floor(0.1 * sampleRate)
    const lenKick = Math.floor(0.15 * sampleRate)
    for (let i = 0; i < lenKick; i++) {
      const t = i / sampleRate
      const env = Math.exp(-t * 25)
      audio[offsetKick + i] = 0.9 * env * Math.sin(2 * Math.PI * 65 * t)
    }

    // 2. Snare en t = 0.6s (ruido blanco + transitorio medio 800 Hz)
    const offsetSnare = Math.floor(0.6 * sampleRate)
    const lenSnare = Math.floor(0.12 * sampleRate)
    for (let i = 0; i < lenSnare; i++) {
      const t = i / sampleRate
      const env = Math.exp(-t * 30)
      const noise = (Math.random() * 2 - 1) * 0.7
      const tone = 0.4 * Math.sin(2 * Math.PI * 800 * t)
      audio[offsetSnare + i] = env * (noise + tone)
    }

    // 3. Hi-Hat cerrado en t = 1.1s (ráfaga corta de alta frecuencia 9000 Hz)
    const offsetHat = Math.floor(1.1 * sampleRate)
    const lenHat = Math.floor(0.04 * sampleRate)
    for (let i = 0; i < lenHat; i++) {
      const t = i / sampleRate
      const env = Math.exp(-t * 80)
      audio[offsetHat + i] = 0.9 * env * Math.sin(2 * Math.PI * 9000 * t)
    }

    // Silencio en [1.2s .. 2.0s] (0.8 segundos de pausa)

    const resultado = clasificarPercusionVocal(audio, sampleRate, {
      bpmProyecto: 120,
      cuantizar: '1/16',
    })

    expect(resultado.notas.length).toBeGreaterThanOrEqual(3)

    const instrumentos = resultado.notas.map((n) => n.instrumento)
    expect(instrumentos).toContain('kick')
    expect(instrumentos).toContain('snare')
    expect(instrumentos.some((inst) => inst === 'hihat_closed' || inst === 'hihat_open')).toBe(true)

    // Verificar asignación de notas MIDI estándar de batería
    const notasMidi = resultado.notas.map((n) => n.notaMidi)
    expect(notasMidi).toContain(36) // Kick
    expect(notasMidi).toContain(38) // Snare

    // Pausa detectada al final
    expect(resultado.metricas.pausas.length).toBeGreaterThan(0)
    const pausaLarga = resultado.metricas.pausas.find((p) => p.duracion >= 0.3)
    expect(pausaLarga).toBeDefined()
  })

  it('genera informe descriptivo completo para la IA (generarDescripcionMusicalAudio)', () => {
    const duracionSeg = 1.5
    const n = Math.floor(duracionSeg * sampleRate)
    const audio = new Float64Array(n)

    // Agregamos un golpe de kick y algo de contenido armónico
    for (let i = 0; i < 2000; i++) {
      audio[i] = 0.8 * Math.sin((2 * Math.PI * 70 * i) / sampleRate)
    }

    const reporte = generarDescripcionMusicalAudio(audio, sampleRate, {
      bpmProyecto: 128,
      cuantizar: '1/16',
    })

    expect(reporte.duracionSeg).toBe(1.5)
    expect(reporte.bpmEstimado).toBe(128)
    expect(reporte.resumenParaIA).toContain('=== REPORTE JASWAVE AUDIOLENS ===')
    expect(reporte.resumenParaIA).toContain('Tonalidad estimada:')
    expect(reporte.resumenParaIA).toContain('Desglose de percusión detectada')
  })
})

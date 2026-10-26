import { describe, it, expect } from 'vitest'
import {
  hzAMidiFloat,
  midiANombreNota,
  ajustarMidiAEscala,
  estimarFrecuenciaYIN,
  extraerMelodiaMidiDeAudio,
} from './pitch-tracking'

describe('Voice-to-Melody Pitch Tracking', () => {
  it('convierte frecuencias Hz a números y nombres MIDI correctos', () => {
    expect(hzAMidiFloat(440)).toBeCloseTo(69, 1)
    expect(midiANombreNota(69)).toBe('A4')

    expect(hzAMidiFloat(261.626)).toBeCloseTo(60, 1)
    expect(midiANombreNota(60)).toBe('C4')

    expect(midiANombreNota(36)).toBe('C2')
    expect(midiANombreNota(72)).toBe('C5')
  })

  it('ajusta semitonos desafinados a la escala del proyecto', () => {
    // En C Mayor (C, D, E, F, G, A, B)
    // D# (semitono 3) debe ajustarse a D (2) o E (4)
    const pitchAjustadoMayor = ajustarMidiAEscala(63.2, true, 'C', 'mayor')
    expect([62, 64]).toContain(pitchAjustadoMayor)

    // Nota que ya está en la escala (E = 64)
    expect(ajustarMidiAEscala(64.1, true, 'C', 'mayor')).toBe(64)

    // Sin ajuste a escala (cromático puro)
    expect(ajustarMidiAEscala(63.2, false)).toBe(63)
  })

  it('estima con precisión la frecuencia fundamental (f0) con algoritmo YIN', () => {
    const sr = 44100
    const durationSec = 0.2
    const n = Math.floor(sr * durationSec)
    const buffer = new Float64Array(n)

    // Generar tono senoidal puro de 440 Hz (A4)
    const freqObjetivo = 440
    for (let i = 0; i < n; i++) {
      buffer[i] = 0.8 * Math.sin((2 * Math.PI * freqObjetivo * i) / sr)
    }

    const { freqHz, confianza } = estimarFrecuenciaYIN(buffer, 0, 2048, sr, 0.15)
    expect(confianza).toBeGreaterThan(0.85)
    expect(freqHz).toBeGreaterThan(435)
    expect(freqHz).toBeLessThan(445)
  })

  it('ignora silencio y ruido aperiódico', () => {
    const sr = 44100
    const bufferSilencio = new Float64Array(2048)
    const resSilencio = estimarFrecuenciaYIN(bufferSilencio, 0, 2048, sr)
    expect(resSilencio.freqHz).toBe(0)
    expect(resSilencio.confianza).toBe(0)

    // Ruido blanco
    const bufferRuido = new Float64Array(2048)
    for (let i = 0; i < bufferRuido.length; i++) {
      bufferRuido[i] = (Math.random() - 0.5) * 0.2
    }
    const resRuido = estimarFrecuenciaYIN(bufferRuido, 0, 2048, sr)
    expect(resRuido.confianza).toBeLessThan(0.7)
  })

  it('extrae secuencia melódica MIDI segmentada con duraciones y dinámicas', () => {
    const sr = 44100
    const srHalfSec = Math.floor(sr * 0.4)
    const buffer = new Float64Array(srHalfSec * 2)

    // Nota 1: A4 (440 Hz) durante 0.4s
    for (let i = 0; i < srHalfSec; i++) {
      buffer[i] = 0.7 * Math.sin((2 * Math.PI * 440 * i) / sr)
    }

    // Nota 2: E5 (659.25 Hz) durante 0.4s
    for (let i = 0; i < srHalfSec; i++) {
      buffer[srHalfSec + i] = 0.6 * Math.sin((2 * Math.PI * 659.25 * i) / sr)
    }

    const res = extraerMelodiaMidiDeAudio(buffer, {
      sampleRate: sr,
      bpmProyecto: 120,
      cuantizar: '1/16',
      ajusteEscala: false,
    })

    expect(res.notas.length).toBeGreaterThanOrEqual(2)
    // Primera nota debe ser A4 (pitch 69)
    expect(res.notas[0]?.pitch).toBe(69)
    expect(res.notas[0]?.notaNombre).toBe('A4')
    // Segunda nota debe ser E5 (pitch 76)
    const ultimaNota = res.notas[res.notas.length - 1]
    expect(ultimaNota?.pitch).toBe(76)
    expect(ultimaNota?.notaNombre).toBe('E5')
  })
})

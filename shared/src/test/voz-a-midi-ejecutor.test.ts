/**
 * Voz → MIDI a través del ejecutor real: pista válida, undo/redo, audio obligatorio y parámetros inválidos.
 * (analysis-commands.test.ts llama al handler directamente y se salta validación, ejecutor y undo.)
 */
import { describe, it, expect } from 'vitest'
import { crearTiendaDAW } from '../state/tienda'
import { crearEstadoInicial } from '../state/estado-inicial'
import type { MidiClip } from '../types/clips'

const SR = 44100

function seno(hz: number, seg: number, amp = 0.8): number[] {
  return Array.from({ length: Math.floor(seg * SR) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR))
}

/** Dos notas: A4 (440 Hz) y luego D5 (587,33 Hz) separadas por un silencio breve. */
function tarareo(): number[] {
  return [...seno(440, 0.5), ...new Array(Math.floor(0.12 * SR)).fill(0), ...seno(587.33, 0.5)]
}

function tienda() {
  return crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
}

describe('analysis.voiceToMelody por el ejecutor', () => {
  it('crea una pista de instrumento válida con un clip MIDI de notas bien formadas', async () => {
    const t = tienda()
    const antes = t.obtenerEstado().project.tracks.length
    const r = await t.executor.execute('analysis.voiceToMelody', {
      audioData: tarareo(),
      sampleRate: SR,
      bpm: 120,
      cuantizar: '1/16',
      tonalidadRaiz: 'D',
      tonalidadEscala: 'mayor',
      instrumento: 'piano',
      crearPista: true,
    })
    expect(r.success).toBe(true)
    const tracks = t.obtenerEstado().project.tracks
    expect(tracks.length).toBe(antes + 1)
    const pista = tracks[tracks.length - 1]!
    // pista con los campos reales del dominio (no los nombres inventados que había antes)
    expect(pista.tipo).toBe('instrumento')
    expect(pista.volumen).toBe(1)
    expect(pista.silenciada).toBe(false)
    expect(pista.soloActiva).toBe(false)
    expect(Array.isArray(pista.plugins)).toBe(true)
    expect(pista.nombre).toContain('Grand Piano')
    const clip = pista.clips[0] as MidiClip
    expect(clip.tipo).toBe('midi')
    expect(clip.trackId).toBe(pista.id)
    expect(clip.notas.length).toBe(2)
    expect(clip.notas.map((n) => n.pitch)).toEqual([69, 74]) // A4, D5 (en Re mayor)
    for (const n of clip.notas) {
      expect(typeof n.id).toBe('string')
      expect(n.canal).toBe(0)
      expect(n.seleccionada).toBe(false)
      expect(n.velocidad).toBeGreaterThanOrEqual(1)
      expect(n.duracion).toBeGreaterThan(0)
    }
    // los ids de las notas son únicos y no dependen del índice
    expect(new Set(clip.notas.map((n) => n.id)).size).toBe(clip.notas.length)
    expect(r.result).toMatchObject({ totalNotas: 2, trackId: pista.id, clipId: clip.id })
  })

  it('se puede deshacer y rehacer (antes la pista creada no tenía undo)', async () => {
    const t = tienda()
    const antes = t.obtenerEstado().project.tracks.length
    const r = await t.executor.execute('analysis.voiceToMelody', { audioData: tarareo(), sampleRate: SR, crearPista: true })
    expect(r.success).toBe(true)
    expect(t.executor.getUndoDepth()).toBeGreaterThan(0)
    const u = await t.executor.undo()
    expect(u.success).toBe(true)
    expect(t.obtenerEstado().project.tracks.length).toBe(antes)
    const rr = await t.executor.redo()
    expect(rr.success).toBe(true)
    const tracks = t.obtenerEstado().project.tracks
    expect(tracks.length).toBe(antes + 1)
    expect((tracks[tracks.length - 1]!.clips[0] as MidiClip).notas.length).toBe(2)
  })

  it('en una pista existente añade el clip en el compás pedido y el undo lo quita', async () => {
    const t = tienda()
    await t.executor.execute('track.create', { nombre: 'Teclas', tipo: 'instrumento' })
    const trackId = t.obtenerEstado().project.tracks.find((x) => x.nombre === 'Teclas')!.id
    const r = await t.executor.execute('analysis.voiceToMelody', {
      audioData: tarareo(),
      sampleRate: SR,
      trackId,
      inicioCompas: 4,
    })
    expect(r.success).toBe(true)
    const pista = t.obtenerEstado().project.tracks.find((x) => x.id === trackId)!
    expect(pista.clips.length).toBe(1)
    expect(pista.clips[0]!.inicio).toBe(16) // compás 4 en 4/4 = beat 16
    await t.executor.undo()
    expect(t.obtenerEstado().project.tracks.find((x) => x.id === trackId)!.clips.length).toBe(0)
  })

  it('falla con un error claro (sin inventar silencio) cuando no llega audioData', async () => {
    const t = tienda()
    const r = await t.executor.execute('analysis.voiceToMelody', { clipId: 'clip-inexistente', crearPista: true })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r)).toMatch(/audioData/)
    expect(t.obtenerEstado().project.tracks.length).toBe(crearEstadoInicial().project.tracks.length)
  })

  it('rechaza sampleRate, bpm y muestras no válidos', async () => {
    const t = tienda()
    const audioData = seno(440, 0.3)
    const sr0 = await t.executor.execute('analysis.voiceToMelody', { audioData, sampleRate: 0 })
    expect(sr0.success).toBe(false)
    const bpm0 = await t.executor.execute('analysis.voiceToMelody', { audioData, sampleRate: SR, bpm: 0 })
    expect(bpm0.success).toBe(false)
    const nan = await t.executor.execute('analysis.voiceToMelody', { audioData: [0.1, Number.NaN, 0.2], sampleRate: SR })
    expect(nan.success).toBe(false)
  })

  it('con una pista de audio como destino falla en vez de informar éxito sin crear nada', async () => {
    const t = tienda()
    await t.executor.execute('track.create', { nombre: 'Voz', tipo: 'audio' })
    const trackId = t.obtenerEstado().project.tracks.find((x) => x.nombre === 'Voz')!.id
    const r = await t.executor.execute('analysis.voiceToMelody', { audioData: tarareo(), sampleRate: SR, trackId })
    expect(r.success).toBe(false)
  })

  it('el ajuste a escala usa la tonalidad pedida: G# en La menor sube a A, no baja una octava', async () => {
    const t = tienda()
    const r = await t.executor.execute('analysis.voiceToMelody', {
      audioData: seno(415.3, 0.5), // G#4
      sampleRate: SR,
      tonalidadRaiz: 'A',
      tonalidadEscala: 'menor',
      crearPista: true,
    })
    expect(r.success).toBe(true)
    const todas = t.obtenerEstado().project.tracks; const pista = todas[todas.length - 1]!
    const pitch = (pista.clips[0] as MidiClip).notas[0]!.pitch
    expect([67, 69]).toContain(pitch) // G4 o A4, nunca ±12
  })
})

describe('analysis.voiceToDrums y extractMidi por el ejecutor', () => {
  function beatbox(): number[] {
    const audio = new Array(Math.floor(2 * SR)).fill(0)
    // bombo (65 Hz con caída) en 0 s y 1 s
    for (const inicio of [0, SR]) {
      for (let i = 0; i < 3000; i++) audio[inicio + i] = 0.9 * Math.sin((2 * Math.PI * 65 * i) / SR) * Math.exp(-i / 1200)
    }
    return audio
  }

  it('voiceToDrums crea la pista, informa el conteo real y se puede deshacer', async () => {
    const t = tienda()
    const antes = t.obtenerEstado().project.tracks.length
    const r = await t.executor.execute('analysis.voiceToDrums', {
      audioData: beatbox(),
      sampleRate: SR,
      bpm: 120,
      crearPista: true,
      nombrePista: 'Beat de prueba',
    })
    expect(r.success).toBe(true)
    const res = r.result as { totalNotas: number; conteo: { kicks: number; snares: number; hihats: number } }
    expect(res.totalNotas).toBeGreaterThan(0)
    // la UI leía `conteo.kicks`: ahora existe y es coherente con las notas
    expect(res.conteo.kicks + res.conteo.snares + res.conteo.hihats).toBeLessThanOrEqual(res.totalNotas)
    expect(res.conteo.kicks).toBeGreaterThan(0)
    expect(t.obtenerEstado().project.tracks.length).toBe(antes + 1)
    await t.executor.undo()
    expect(t.obtenerEstado().project.tracks.length).toBe(antes)
  })

  it('extractMidi con crearPistas añade pistas válidas y un solo undo las quita todas', async () => {
    const t = tienda()
    const antes = t.obtenerEstado().project.tracks.length
    const r = await t.executor.execute('analysis.extractMidi', {
      audioData: tarareo(),
      sampleRate: SR,
      tipo: 'all',
      crearPistas: true,
    })
    expect(r.success).toBe(true)
    const creadas = (r.result as { pistasCreadas: { tipo: string }[] }).pistasCreadas
    expect(creadas.some((p) => p.tipo === 'melodia')).toBe(true)
    expect(t.obtenerEstado().project.tracks.length).toBe(antes + creadas.length)
    await t.executor.undo()
    expect(t.obtenerEstado().project.tracks.length).toBe(antes)
  })
})

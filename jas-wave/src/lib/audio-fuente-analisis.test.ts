/**
 * Fuente de audio del agente: remuestreo con anti-aliasing, adjuntos y clips.
 * npx tsx --test src/lib/audio-fuente-analisis.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import {
  MAX_ANALISIS_SEG,
  SR_ANALISIS,
  audioDeClip,
  mezclarAMono,
  obtenerAudioAdjunto,
  prepararPayloadAnalisisAudio,
  quitarAudioAdjunto,
  registrarAudioAdjunto,
  remuestrear,
} from './audio-fuente-analisis'

function seno(hz: number, seg: number, sr: number, amp = 0.8): Float32Array {
  const out = new Float32Array(Math.floor(seg * sr))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr)
  return out
}

/** Amplitud de la componente de `hz` (Goertzel normalizado a amplitud de seno). */
function amplitudEn(x: ArrayLike<number>, hz: number, sr: number): number {
  const w = (2 * Math.PI * hz) / sr
  let re = 0
  let im = 0
  for (let i = 0; i < x.length; i++) {
    re += (x[i] ?? 0) * Math.cos(w * i)
    im -= (x[i] ?? 0) * Math.sin(w * i)
  }
  return (2 * Math.hypot(re, im)) / x.length
}

const db = (a: number) => 20 * Math.log10(Math.max(a, 1e-12))

describe('remuestrear', () => {
  it('conserva la frecuencia y la amplitud de un tono al pasar de 48 kHz a 22,05 kHz', () => {
    const y = remuestrear(seno(1000, 1, 48000), 48000, SR_ANALISIS)
    assert.ok(Math.abs(y.length - SR_ANALISIS) <= 1)
    // se mide en el centro para evitar el borde
    const centro = y.subarray(2000, y.length - 2000)
    assert.ok(Math.abs(amplitudEn(centro, 1000, SR_ANALISIS) - 0.8) < 0.02)
  })

  it('un tono por encima del Nyquist de destino se atenúa mucho en vez de plegarse (alias)', () => {
    // 15 kHz > 11,025 kHz: sin filtro aparecería un alias en 22050-15000 = 7050 Hz
    const y = remuestrear(seno(15000, 1, 48000), 48000, SR_ANALISIS)
    const centro = y.subarray(2000, y.length - 2000)
    assert.ok(db(amplitudEn(centro, 7050, SR_ANALISIS)) < -40, `alias a ${db(amplitudEn(centro, 7050, SR_ANALISIS)).toFixed(1)} dB`)
  })

  it('recorta con desdeSeg y maxSeg', () => {
    const x = seno(440, 3, 22050)
    const y = remuestrear(x, 22050, 22050, 1, 1)
    assert.equal(y.length, 22050)
    assert.equal(y[0], x[22050])
  })

  it('la nota de voz de 10 s a 48 kHz sigue afinada tras el remuestreo (regresión +29 semitonos)', () => {
    const y = remuestrear(seno(440, 10, 48000), 48000, SR_ANALISIS, 0, MAX_ANALISIS_SEG)
    const centro = y.subarray(2000, 40000)
    assert.ok(amplitudEn(centro, 440, SR_ANALISIS) > 0.75)
    // lo que daba el submuestreo sin filtro: la misma señal leída como si fuera de 48 kHz estaría en 440*48000/8820
    assert.ok(amplitudEn(centro, 440 * (48000 / SR_ANALISIS), SR_ANALISIS) < 0.01)
  })

  it('entrada vacía → salida vacía', () => {
    assert.equal(remuestrear(new Float32Array(0), 48000, SR_ANALISIS).length, 0)
  })
})

describe('mezclarAMono', () => {
  it('promedia los canales (no pierde una voz solo en el canal derecho)', () => {
    const izq = new Float32Array(100)
    const der = new Float32Array(100).fill(0.6)
    const mono = mezclarAMono([izq, der])
    assert.ok(Math.abs((mono[10] ?? 0) - 0.3) < 1e-6)
  })
})

describe('prepararPayloadAnalisisAudio', () => {
  beforeEach(() => {
    for (const id of ['a1', 'a2']) quitarAudioAdjunto(id)
  })

  function estadoConClipAudio() {
    const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    return t
  }

  it('deja intactas las acciones que no son de análisis de audio', () => {
    const p = { trackId: 't1' }
    assert.equal(prepararPayloadAnalisisAudio('track.create', p, crearEstadoInicial(), () => undefined), p)
  })

  it('usa el adjunto indicado por audioRef y no envía audioRef al comando', () => {
    registrarAudioAdjunto('a1', { audioData: [0.1, 0.2], sampleRate: SR_ANALISIS, duracionSeg: 1 })
    registrarAudioAdjunto('a2', { audioData: [0.3, 0.4], sampleRate: SR_ANALISIS, duracionSeg: 1 })
    const p = prepararPayloadAnalisisAudio('analysis.voiceToMelody', { audioRef: 'a2', crearPista: true }, crearEstadoInicial(), () => undefined)
    assert.deepEqual(p.audioData, [0.3, 0.4])
    assert.equal(p.sampleRate, SR_ANALISIS)
    assert.ok(!('audioRef' in p))
    assert.equal(p.crearPista, true)
  })

  it('con un solo adjunto en el chat lo usa por defecto; con varios exige indicar cuál', () => {
    registrarAudioAdjunto('a1', { audioData: [0.5], sampleRate: SR_ANALISIS, duracionSeg: 1 })
    const uno = prepararPayloadAnalisisAudio('analysis.extractMidi', {}, crearEstadoInicial(), () => undefined)
    assert.deepEqual(uno.audioData, [0.5])
    registrarAudioAdjunto('a2', { audioData: [0.6], sampleRate: SR_ANALISIS, duracionSeg: 1 })
    assert.throws(() => prepararPayloadAnalisisAudio('analysis.extractMidi', {}, crearEstadoInicial(), () => undefined), /audioRef|clipId/)
  })

  it('un audioRef desconocido es un error explícito', () => {
    assert.throws(() => prepararPayloadAnalisisAudio('analysis.audioLens', { audioRef: 'nope' }, crearEstadoInicial(), () => undefined), /nope/)
    assert.equal(obtenerAudioAdjunto('nope'), undefined)
  })

  it('resuelve un clip de audio del proyecto desde su buffer decodificado y lo remuestrea', async () => {
    const t = estadoConClipAudio()
    await t.executor.execute('track.create', { nombre: 'Voz', tipo: 'audio' })
    const pista = t.obtenerEstado().project.tracks.find((x) => x.nombre === 'Voz')!
    const r = await t.executor.execute('clip.create', { pistaId: pista.id, nombre: 'toma', inicio: 0, duracion: 8 })
    assert.equal(r.success, true)
    // el clip creado por el comando genérico no trae `source`: se completa en el estado como lo hace la importación
    const estado = t.obtenerEstado()
    const clipId = estado.project.tracks.find((x) => x.id === pista.id)!.clips[0]!.id
    const base = estado.project.tracks.find((x) => x.id === pista.id)!.clips[0]!
    const conAudio = {
      ...estado,
      project: {
        ...estado.project,
        tracks: estado.project.tracks.map((tr) =>
          tr.id === pista.id ? { ...tr, clips: [{ ...base, tipo: 'audio', source: { ruta: 'media/voz.wav' } }] } : tr,
        ),
      },
    } as typeof estado
    const buscar = (clave: string) =>
      clave === 'media/voz.wav' ? { sampleRate: 48000, channels: [seno(440, 4, 48000), seno(440, 4, 48000)] } : undefined
    const a = audioDeClip(conAudio, clipId, buscar)
    assert.equal(a.sampleRate, SR_ANALISIS)
    assert.ok(a.duracionSeg > 3.9)
    const centro = a.audioData.slice(2000, 40000)
    assert.ok(amplitudEn(centro, 440, SR_ANALISIS) > 0.75)
    assert.throws(() => audioDeClip(conAudio, 'no-existe', buscar), /Clip no encontrado/)
    assert.throws(() => audioDeClip(conAudio, clipId, () => undefined), /no está cargado/)
  })
})

/**
 * npx tsx --test src/lib/audio-bytes-import.test.ts
 *
 * «Insertar como clip de audio» desde el chat: el audio se guarda como WAV en el
 * proyecto y el clip apunta a ese archivo (no solo a una forma de onda).
 */
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { crearEstadoInicial } from '../../../shared/src/state/estado-inicial'
import { crearTiendaDAW } from '../../../shared/src/state/tienda'
import { audioEngine } from '@/lib/audio-engine'
import { importAudioBytesToTrack } from './audio-import-agent'

type Guardado = { ruta: string; bytes: Uint8Array }

function bufferFalso(segundos: number, sr = 48000) {
  const length = Math.round(segundos * sr)
  const canal = new Float32Array(length).map((_, i) => Math.sin(i / 20) * 0.5)
  return {
    duration: segundos,
    length,
    sampleRate: sr,
    numberOfChannels: 1,
    getChannelData: () => canal,
  }
}

describe('importAudioBytesToTrack', () => {
  const g = globalThis as unknown as { window?: unknown }
  const motor = audioEngine as unknown as Record<string, unknown>
  const originales = { decode: motor.decodeArrayBuffer, set: motor.setAudioBuffer }
  let guardados: Guardado[]
  let buffers: string[]

  beforeEach(() => {
    guardados = []
    buffers = []
    motor.decodeArrayBuffer = async () => bufferFalso(2)
    motor.setAudioBuffer = (id: string) => buffers.push(id)
    g.window = {
      electron: {
        recordingsDir: async (ruta?: string) => (ruta ? 'C:/proyectos/tema/media/grabaciones' : null),
        fileSaveBinary: async (ruta: string, bytes: Uint8Array) => {
          guardados.push({ ruta, bytes })
          return { success: true }
        },
        userDataPath: async () => 'C:/userdata',
      },
    }
  })

  afterEach(() => {
    motor.decodeArrayBuffer = originales.decode
    motor.setAudioBuffer = originales.set
    delete g.window
  })

  it('guarda un WAV en el proyecto y crea la pista y el clip con ese archivo', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    tienda.obtenerEstado().project.ruta = 'C:/proyectos/tema/tema.jaswave'
    const r = await importAudioBytesToTrack(tienda, { bytes: new ArrayBuffer(8), nombre: 'nota.webm', trackName: 'Nota de voz' })

    assert.equal(guardados.length, 1)
    assert.match(guardados[0]!.ruta, /^C:\/proyectos\/tema\/media\/grabaciones\/grabacion-.*\.wav$/)
    assert.equal(new TextDecoder().decode(guardados[0]!.bytes.slice(0, 4)), 'RIFF')
    assert.ok(r.dentroDelProyecto)
    assert.match(r.sourceId, /^media\/grabaciones\//)
    assert.deepEqual(buffers, [r.sourceId])

    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.id === r.trackId)!
    assert.equal(pista.nombre, 'Nota de voz')
    const clip = pista.clips[0] as unknown as { source?: { ruta: string }; duracion: number; nombre: string }
    assert.equal(clip.source?.ruta, r.sourceId)
    assert.equal(clip.nombre, 'nota')
    assert.ok(Math.abs(clip.duracion - 4) < 1e-6, '2 s a 120 BPM = 4 beats')
  })

  it('sin proyecto guardado usa userData y lo indica', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const r = await importAudioBytesToTrack(tienda, { bytes: new ArrayBuffer(8), nombre: 'voz.wav' })
    assert.equal(r.dentroDelProyecto, false)
    assert.match(r.sourceId, /^C:\/userdata\/media\/grabaciones\//)
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { argsCodificacion, binarioFfmpeg, extensionCoincide, resolverFfmpeg } from './audio-encoder'

describe('audio-encoder', () => {
  it('arma argumentos por formato sin flags del renderer', () => {
    assert.deepEqual(argsCodificacion('mp3', { bitrate: 320 }), ['-c:a', 'libmp3lame', '-b:a', '320k'])
    assert.deepEqual(argsCodificacion('flac', { bitDepth: 16 }).slice(-2), ['-sample_fmt', 's16'])
    assert.deepEqual(argsCodificacion('flac', { bitDepth: 32 }).slice(-2), ['-sample_fmt', 's32'])
    assert.deepEqual(argsCodificacion('aiff', { bitDepth: 24 }), ['-c:a', 'pcm_s24be'])
    assert.deepEqual(argsCodificacion('aac', { bitrate: 256, sampleRate: 44100 }).slice(0, 4), ['-ar', '44100', '-c:a', 'aac'])
    assert.ok(argsCodificacion('opus').includes('libopus'))
    assert.ok(argsCodificacion('ogg').includes('libvorbis'))
  })

  it('rechaza bitrate y frecuencia fuera de rango', () => {
    assert.throws(() => argsCodificacion('mp3', { bitrate: 1000 }), /bitrate/)
    assert.throws(() => argsCodificacion('mp3', { sampleRate: 11025 }), /frecuencia/)
  })

  it('la extensión debe coincidir con el formato', () => {
    assert.equal(extensionCoincide('mp3', 'C:/x/cancion.mp3'), true)
    assert.equal(extensionCoincide('mp3', 'C:/x/cancion.wav'), false)
    assert.equal(extensionCoincide('aac', 'C:/x/cancion.m4a'), true)
    assert.equal(extensionCoincide('aiff', 'C:/x/cancion.aif'), true)
  })

  it('prefiere el ffmpeg de JasWave, luego el del entorno y luego el del PATH', async () => {
    const propio = binarioFfmpeg('C:/LAD')
    const r1 = await resolverFfmpeg({ localAppData: 'C:/LAD', probar: async (b) => b === propio || b === 'ffmpeg' })
    assert.deepEqual(r1, { ruta: propio, origen: 'jaswave' })
    const r2 = await resolverFfmpeg({ localAppData: 'C:/LAD', env: { JASWAVE_FFMPEG: 'D:/f.exe' }, probar: async (b) => b === 'D:/f.exe' })
    assert.equal(r2?.origen, 'entorno')
    const r3 = await resolverFfmpeg({ localAppData: 'C:/LAD', probar: async (b) => b === 'ffmpeg' })
    assert.equal(r3?.origen, 'path')
    assert.equal(await resolverFfmpeg({ localAppData: 'C:/LAD', probar: async () => false }), null)
  })
})

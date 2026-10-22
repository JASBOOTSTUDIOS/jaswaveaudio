import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AVISO_DURACION_MIN,
  RECHAZO_DURACION_HORAS,
  RECHAZO_TAMANO_BYTES,
  carpetaDeProyecto,
  carpetaMediaProyecto,
  clipsConMediaPendiente,
  esExtensionAudioSoportada,
  esRutaMediaGrabacion,
  esRutaMediaPendiente,
  extensionAudio,
  nombreUnicoMedia,
  normalizarRutaRelativa,
  rutaRelativaMedia,
  rutaRelativaPendiente,
  sanitizarNombreArchivo,
  validarImportacionAudio,
} from './project-media'

describe('project-media (rutas)', () => {
  it('extrae la extensión en minúsculas', () => {
    assert.equal(extensionAudio('C:/a/b/Intro.WAV'), '.wav')
    assert.equal(extensionAudio('sin-extension'), '')
    assert.equal(extensionAudio('a.b.flac'), '.flac')
  })

  it('acepta solo los formatos de audio soportados', () => {
    assert.equal(esExtensionAudioSoportada('a.wav'), true)
    assert.equal(esExtensionAudioSoportada('a.aiff'), true)
    assert.equal(esExtensionAudioSoportada('a.m4a'), true)
    assert.equal(esExtensionAudioSoportada('a.txt'), false)
    assert.equal(esExtensionAudioSoportada('a'), false)
  })

  it('normaliza rutas relativas', () => {
    assert.equal(normalizarRutaRelativa('media\\a.wav'), 'media/a.wav')
    assert.equal(normalizarRutaRelativa('media//a.wav'), 'media/a.wav')
    // La barra inicial se conserva: sigue siendo una ruta absoluta.
    assert.equal(normalizarRutaRelativa('/media//a.wav'), '/media/a.wav')
  })

  it('reconoce media pendiente y grabaciones', () => {
    assert.equal(esRutaMediaPendiente('media/pending/a.wav'), true)
    assert.equal(esRutaMediaPendiente('media/a.wav'), false)
    assert.equal(esRutaMediaGrabacion('media/grabaciones/toma.wav'), true)
  })

  it('construye rutas relativas de media', () => {
    assert.equal(rutaRelativaMedia('intro.wav'), 'media/intro.wav')
    assert.equal(rutaRelativaPendiente('intro.wav'), 'media/pending/intro.wav')
  })

  it('resuelve la carpeta del proyecto', () => {
    assert.equal(carpetaDeProyecto('C:\\proyectos\\cancion.jaswave'), 'C:\\proyectos')
    assert.equal(carpetaDeProyecto('C:\\proyectos\\cancion.jaswave'), 'C:\\proyectos')
    assert.equal(carpetaDeProyecto(null), null)
    assert.equal(carpetaMediaProyecto('C:/proyectos/cancion.jaswave'), 'C:/proyectos/media')
  })
})

describe('project-media (nombres)', () => {
  it('sanitiza nombres', () => {
    assert.equal(sanitizarNombreArchivo('a/b.wav'), 'a_b.wav')
    assert.equal(sanitizarNombreArchivo('  '), 'audio')
  })

  it('genera nombres únicos', () => {
    assert.equal(nombreUnicoMedia('intro.wav', []), 'intro.wav')
    assert.equal(nombreUnicoMedia('intro.wav', ['intro.wav']), 'intro (2).wav')
    assert.equal(nombreUnicoMedia('intro.wav', ['intro.wav', 'intro (2).wav']), 'intro (3).wav')
  })
})

describe('project-media (validación de importación)', () => {
  it('acepta un WAV normal', () => {
    assert.equal(validarImportacionAudio({ ruta: 'a.wav' }).nivel, 'ok')
  })

  it('rechaza un formato no soportado', () => {
    const r = validarImportacionAudio({ ruta: 'a.txt' })
    assert.equal(r.nivel, 'error')
    assert.match(r.mensaje ?? '', /no soportado/i)
  })

  it('rechaza archivos enormes', () => {
    const r = validarImportacionAudio({ ruta: 'a.wav', tamanoBytes: RECHAZO_TAMANO_BYTES + 1 })
    assert.equal(r.nivel, 'error')
    assert.match(r.mensaje ?? '', /2 GB/)
  })

  it('avisa de archivos largos pero los deja pasar', () => {
    const r = validarImportacionAudio({
      ruta: 'a.wav',
      duracionSec: (AVISO_DURACION_MIN + 5) * 60,
    })
    assert.equal(r.nivel, 'aviso')
  })

  it('rechaza archivos de más de 2 horas', () => {
    const r = validarImportacionAudio({
      ruta: 'a.wav',
      duracionSec: (RECHAZO_DURACION_HORAS + 1) * 3600,
    })
    assert.equal(r.nivel, 'error')
  })
})

describe('project-media (clips con media pendiente)', () => {
  it('lista solo los clips pendientes', () => {
    const proyecto = {
      tracks: [
        {
          id: 'p1',
          clips: [
            { id: 'c1', source: { ruta: 'media/pending/a.wav' } },
            { id: 'c2', source: { ruta: 'media/b.wav' } },
            { id: 'c3', source: {} },
          ],
        },
      ],
    }
    const pendientes = clipsConMediaPendiente(proyecto)
    assert.equal(pendientes.length, 1)
    assert.equal(pendientes[0]!.clipId, 'c1')
    assert.equal(pendientes[0]!.pistaId, 'p1')
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { dbAPorcentaje } from './audio-conversions'
import { alturasEspectro, picoAPorcentajeVu, UMBRAL_CLIP } from './meter-scale'

describe('picoAPorcentajeVu', () => {
  it('alinea el VU con las marcas del fader (0 dBFS a la altura de la marca 0)', () => {
    assert.equal(picoAPorcentajeVu(1), 100 - dbAPorcentaje(0))
    const menos6 = Math.pow(10, -6 / 20)
    assert.ok(Math.abs(picoAPorcentajeVu(menos6) - (100 - dbAPorcentaje(-6))) < 1e-9)
  })

  it('silencio y valores no válidos quedan en 0', () => {
    assert.equal(picoAPorcentajeVu(0), 0)
    assert.equal(picoAPorcentajeVu(-1), 0)
    assert.equal(picoAPorcentajeVu(Number.NaN), 0)
    assert.equal(picoAPorcentajeVu(1e-6), 0) // por debajo de −60 dB
  })

  it('el clip se detecta en el techo del host (1.0)', () => {
    assert.ok(1 >= UMBRAL_CLIP)
    assert.ok(Math.pow(10, -0.1 / 20) < UMBRAL_CLIP)
  })
})

describe('alturasEspectro', () => {
  it('mapea −90…0 dBFS a 0…1 y recorta fuera de rango', () => {
    assert.deepEqual(alturasEspectro([-140, -90, -45, 0, 6]), [0, 0, 0.5, 1, 1])
  })

  it('acepta Float32Array', () => {
    assert.deepEqual(alturasEspectro(new Float32Array([-90, 0])), [0, 1])
  })
})

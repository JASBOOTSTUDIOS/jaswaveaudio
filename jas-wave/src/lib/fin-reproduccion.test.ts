import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decidirFinReproduccion, type EntradaFin } from './fin-reproduccion'

const base: EntradaFin = {
  ahoraSec: 0,
  finContenidoSec: 120,
  loop: { activo: false },
  detenerAlFinal: true,
  picoMaster: 0,
  silencioSec: 0,
}

describe('fin de reproducción', () => {
  it('antes del final sigue sonando', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 60 }), { tipo: 'seguir' })
  })

  it('tras el final espera a que se apague la cola y entonces se detiene', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 121, silencioSec: 0.2 }), { tipo: 'seguir' })
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 122, silencioSec: 0.6 }), { tipo: 'detener' })
  })

  it('con una cola que no se apaga, se detiene a los 10 s', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 130.1, silencioSec: 0 }), { tipo: 'detener' })
  })

  it('con la opción desactivada sigue sin fin', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 500, silencioSec: 9, detenerAlFinal: false }), { tipo: 'seguir' })
  })

  it('loop con región: vuelve al inicio de la región al llegar a su final', () => {
    const loop = { activo: true, inicioSec: 8, finSec: 16 }
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 15.9, loop }), { tipo: 'seguir' })
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 16, loop }), { tipo: 'saltar', segundos: 8 })
  })

  it('loop sin región: repite la canción entera aunque «detener al final» esté activo', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 120, loop: { activo: true } }), { tipo: 'saltar', segundos: 0 })
  })

  it('proyecto sin contenido: no se detiene solo', () => {
    assert.deepEqual(decidirFinReproduccion({ ...base, ahoraSec: 30, finContenidoSec: null, silencioSec: 5 }), { tipo: 'seguir' })
  })
})

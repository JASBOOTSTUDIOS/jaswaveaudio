import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { scrollParaRevelar } from './scroll-reveal'

describe('scrollParaRevelar', () => {
  it('no mueve nada si ya se ve entero', () => {
    assert.equal(scrollParaRevelar(100, 300, 150, 60), null)
  })

  it('oculto arriba: alinea su inicio (con margen)', () => {
    assert.equal(scrollParaRevelar(500, 300, 200, 60), 192)
  })

  it('oculto abajo: desplaza lo mínimo para ver su final', () => {
    // vista 0..300, elemento 400..460 → scroll = 460 - 300 + 8
    assert.equal(scrollParaRevelar(0, 300, 400, 60), 168)
  })

  it('más grande que la vista: alinea el inicio; nunca negativo; vista 0 no hace nada', () => {
    assert.equal(scrollParaRevelar(0, 100, 500, 400), 492)
    assert.equal(scrollParaRevelar(50, 300, 2, 60), 0)
    assert.equal(scrollParaRevelar(0, 0, 500, 40), null)
  })
})

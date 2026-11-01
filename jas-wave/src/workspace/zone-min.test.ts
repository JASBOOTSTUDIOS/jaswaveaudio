import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ALTO_PESTANAS_ZONA, minimoPorcentaje, minimoZonaPx } from './zone-min'
import { tamanoMinimoHerramienta } from './types'

describe('mínimo de zona', () => {
  it('el mixer reserva su alto mínimo más la barra de pestañas', () => {
    assert.equal(minimoZonaPx('mixer', 'h'), tamanoMinimoHerramienta('mixer').h + ALTO_PESTANAS_ZONA)
    assert.equal(minimoZonaPx(null, 'h'), 0)
  })

  it('convierte px a % del grupo, nunca por debajo de la base ni por encima del tope', () => {
    assert.equal(minimoPorcentaje(354, 1000, 12, 70), 35.4)
    assert.equal(minimoPorcentaje(50, 1000, 12, 70), 12)
    assert.equal(minimoPorcentaje(900, 1000, 12, 70), 70)
  })

  it('sin medida del grupo usa la base', () => {
    assert.equal(minimoPorcentaje(354, 0, 12, 70), 12)
  })
})

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANCHO_TIRA,
  altoMinimoMixer,
  anchoConRueda,
  limitarAnchoTira,
  seccionesMixer,
  umbralesMixer,
} from './mixer-layout'

describe('ancho de tira (Ctrl + rueda)', () => {
  it('rueda arriba ensancha y abajo estrecha, dentro de los límites', () => {
    assert.equal(anchoConRueda(124, -100), 124 + ANCHO_TIRA.paso)
    assert.equal(anchoConRueda(124, 100), 124 - ANCHO_TIRA.paso)
    assert.equal(anchoConRueda(ANCHO_TIRA.max, -1), ANCHO_TIRA.max)
    assert.equal(anchoConRueda(ANCHO_TIRA.min, 1), ANCHO_TIRA.min)
    assert.equal(anchoConRueda(124, 0), 124)
  })

  it('valores no válidos vuelven al ancho por defecto', () => {
    assert.equal(limitarAnchoTira(Number.NaN), ANCHO_TIRA.defecto)
    assert.equal(limitarAnchoTira(10), ANCHO_TIRA.min)
  })
})

describe('niveles por alto', () => {
  it('se quitan primero los extras (FX), luego la perilla pasa a barra y al final se oculta el paneo', () => {
    assert.deepEqual(seccionesMixer(3), { paneo: 'perilla', extras: true })
    assert.deepEqual(seccionesMixer(2), { paneo: 'perilla', extras: false })
    assert.deepEqual(seccionesMixer(1), { paneo: 'barra', extras: false })
    assert.deepEqual(seccionesMixer(0), { paneo: 'oculto', extras: false })
  })

  it('los umbrales crecen y la tira estrecha necesita más alto (lectura apilada)', () => {
    const [b, p, c] = umbralesMixer(false)
    assert.ok(altoMinimoMixer(false) < b && b < p && p < c)
    const [be, pe, ce] = umbralesMixer(true)
    assert.ok(be > b && pe > p && ce > c)
  })

  it('el hueco vacío que puede quedar entre niveles es pequeño', () => {
    const min = altoMinimoMixer(false)
    const [b, p, c] = umbralesMixer(false)
    // Entre umbrales el sobrante no lo ocupa nada; por encima de `c` la zona de FX lo llena todo.
    // El último salto es mayor: el selector MIDI va fijo (fuera del scroll) junto a la cabecera de FX.
    assert.ok(b - min <= 34 && p - b <= 34 && c - p <= 64)
  })
})

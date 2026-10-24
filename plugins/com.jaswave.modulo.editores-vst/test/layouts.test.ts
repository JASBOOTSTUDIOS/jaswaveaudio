/**
 * npm test (tsx --test): el módulo reconoce los 7 VST de JasWave por su nombre actual y los históricos.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LAYOUTS, layoutPorNombre } from '../src/layouts'

describe('layouts de la réplica web', () => {
  it('incluye los 7 VST con su nombre de manifiesto', () => {
    assert.equal(LAYOUTS.length, 7)
    for (const e of LAYOUTS) assert.equal(layoutPorNombre(e.nombre)?.productId, e.layout.productId)
  })
  it('reconoce los nombres históricos de los FX y descarta plugins de terceros', () => {
    assert.equal(layoutPorNombre('JasWave EQ')?.productId, 'com.jaswave.plugin.param-eq')
    assert.equal(layoutPorNombre('JasWave Compresor')?.productId, 'com.jaswave.plugin.bus-compressor')
    assert.equal(layoutPorNombre('JasWave Limitador')?.productId, 'com.jaswave.plugin.truepeak-limiter')
    assert.equal(layoutPorNombre('JasWave De-esser')?.productId, 'com.jaswave.plugin.smart-deesser')
    assert.equal(layoutPorNombre('jaswave utility')?.productId, 'com.jaswave.plugin.utility-tool')
    assert.equal(layoutPorNombre('Serum'), null)
    assert.equal(layoutPorNombre('Pro-Q 3 EQ'), null)
  })
})

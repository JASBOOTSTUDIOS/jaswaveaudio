/**
 * npm test (tsx --test): el módulo reconoce los 16 VST de JasWave por su nombre actual y los históricos.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LAYOUTS, layoutPorNombre } from '../src/layouts'

describe('layouts de la réplica web', () => {
  it('incluye los 19 VST (7 FX/instrumentos previos + 7 instrumentos independientes + Vocal Tune + Pedal Fix + Audio Doctor + StompLab + Vocal Choir) con su nombre de manifiesto', () => {
    assert.equal(LAYOUTS.length, 19)
    for (const e of LAYOUTS) assert.equal(layoutPorNombre(e.nombre)?.productId, e.layout.productId)
    assert.equal(layoutPorNombre('JasWave Vocal Tune')?.productId, 'com.jaswave.plugin.vocal-tune')
    assert.equal(layoutPorNombre('JasWave Pedal Fix')?.productId, 'com.jaswave.plugin.pedal-fix')
    assert.equal(layoutPorNombre('jaswave pedal')?.productId, 'com.jaswave.plugin.pedal-fix')
  })
  it('cada editor tiene el selector BÁSICO | AVANZADO y su modo Básico deja al menos un control', () => {
    for (const e of LAYOUTS) {
      assert.equal(e.layout.widgets.filter((w) => w.tipo === 'modo').length, 1, e.nombre)
      assert.ok(e.layout.widgets.some((w) => w.basico !== false && w.param !== undefined && w.tipo !== 'section' && !w.pagina), e.nombre)
    }
  })
  it('cada editor tiene un botón RESET en la cabecera, sin parámetro asociado', () => {
    for (const e of LAYOUTS) {
      const resets = e.layout.widgets.filter((w) => w.tipo === 'reset')
      assert.equal(resets.length, 1, `${e.nombre}: ${resets.length} botones RESET`)
      assert.equal(resets[0]!.param, undefined)
    }
  })
  it('los 7 instrumentos independientes se resuelven por su nombre exacto (no por el alias del piano antiguo)', () => {
    const esperado: Record<string, string> = {
      'JasWave Grand Piano': 'com.jaswave.plugin.grand-piano',
      'JasWave Worship Drums': 'com.jaswave.plugin.worship-drums',
      'JasWave Electric Bass': 'com.jaswave.plugin.electric-bass',
      'JasWave Electric Guitar': 'com.jaswave.plugin.electric-guitar',
      'JasWave Shimmer Pad': 'com.jaswave.plugin.shimmer-pad',
      'JasWave Strings Section': 'com.jaswave.plugin.strings-section',
      'JasWave Ambient Atmos': 'com.jaswave.plugin.ambient-atmos',
    }
    for (const [nombre, id] of Object.entries(esperado)) assert.equal(layoutPorNombre(nombre)?.productId, id, nombre)
    assert.equal(layoutPorNombre('JasWave Piano Synth')?.productId, 'com.jaswave.plugin.piano-synth')
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
  it('Shimmer Pad incluye la página MIX / FX del FX Rack con los 58 parámetros estándar (ids 100..230)', () => {
    const l = layoutPorNombre('JasWave Shimmer Pad')!
    const eq = l.widgets.find((w) => w.tipo === 'mixfx-eq')
    assert.ok(eq, 'falta la gráfica del ecualizador')
    assert.equal(eq.base, 100)
    assert.equal(eq.bandas?.length, 6)
    const ids = new Set<number>()
    for (const w of l.widgets.filter((x) => x.pagina === 1)) if (w.param !== undefined) ids.add(w.param)
    for (const b of eq.bandas ?? []) for (const d of [b.freq, b.gain, b.q]) ids.add(d.param)
    assert.equal(ids.size, 58)
    assert.ok([...ids].every((id) => id >= 100 && id <= 230))
    assert.equal(l.widgets.filter((w) => w.tipo === 'pagina' && w.paginaDestino === 1).length, 1)
    assert.equal(l.widgets.filter((w) => w.tipo === 'reset-fx').length, 1)
  })
})

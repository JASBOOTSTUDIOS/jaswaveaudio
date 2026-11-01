/**
 * npx tsx --test src/lib/plugin/fx-legado.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveHostPluginPath, rutaSustitutoFxLegado } from './plugin-info-adapter'

const catalogo = [
  { pluginId: 'jaswave:com.jaswave.plugin.param-eq', name: 'JasWave EQ Parametric Pro', path: 'C:\\VST3\\JasWaveParamEq.vst3' },
  { pluginId: 'jaswave:com.jaswave.plugin.bus-compressor', name: 'JasWave Bus Compressor', path: 'C:\\VST3\\JasWaveBusCompressor.vst3' },
]

describe('K1 — FX del bundle JasWaveFx retirado', () => {
  it('un EQ guardado con JasWaveFx.vst3 se carga con el plugin independiente', () => {
    const p = resolveHostPluginPath(
      { nombre: 'JasWave EQ', id: 'x', descripcion: 'C:\\Users\\a\\AppData\\Local\\Programs\\Common\\VST3\\JasWave\\JasWaveFx.vst3 · EQ' },
      catalogo,
    )
    assert.equal(p, 'C:\\VST3\\JasWaveParamEq.vst3')
  })

  it('sin sustituto instalado conserva la ruta original (el host informará que falta)', () => {
    const ruta = 'C:\\VST3\\JasWave\\JasWaveFx.vst3'
    assert.equal(resolveHostPluginPath({ nombre: 'JasWave Limitador', id: 'y', descripcion: ruta }, catalogo), ruta)
    assert.equal(rutaSustitutoFxLegado('JasWave Compresor', catalogo), 'C:\\VST3\\JasWaveBusCompressor.vst3')
    assert.equal(rutaSustitutoFxLegado('Serum', catalogo), '')
  })

  it('las rutas de otros plugins no se tocan', () => {
    const ruta = 'C:\\VST3\\Serum.vst3'
    assert.equal(resolveHostPluginPath({ nombre: 'JasWave EQ', id: 'z', descripcion: ruta }, catalogo), ruta)
  })
})

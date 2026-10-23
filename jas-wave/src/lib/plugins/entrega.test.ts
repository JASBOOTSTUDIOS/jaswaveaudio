/**
 * npx tsx --test src/lib/plugins/entrega.test.ts
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { _reiniciarPluginsParaPruebas, activarPaquetes } from './registro-plugins'
import { idPluginDeInstancia, instalarPlugins, pluginsFaltantes, type CatalogoPlugins } from './entrega'

const catalogo: CatalogoPlugins = {
  generadoEn: '2026-10-23T00:00:00Z',
  paquetes: [
    { id: 'com.jaswave.plugin.param-eq', nombre: 'JasWave EQ Parametric Pro', version: '1.0.0', url: 'https://x/eq.zip', sha256: 'a'.repeat(64), sizeBytes: 1 },
    { id: 'com.jaswave.plugin.bus-compressor', nombre: 'JasWave Bus Compressor', version: '1.0.0', url: 'https://x/c.zip', sha256: 'b'.repeat(64), sizeBytes: 1 },
    { id: 'com.jaswave.plugin.piano-synth', nombre: 'JasWave Piano Synth', version: '1.0.0', url: 'https://x/p.zip', sha256: 'c'.repeat(64), sizeBytes: 1 },
  ],
}

const proyecto = (pistas: string[][], master: string[] = []) => ({
  project: {
    tracks: pistas.map((nombres, i) => ({ id: `t${i}`, plugins: nombres.map((nombre, j) => ({ id: `p${i}${j}`, nombre })) })),
    master: { plugins: master.map((nombre, j) => ({ id: `m${j}`, nombre })) },
  },
}) as never

describe('D1 — plugins que necesita el proyecto', () => {
  afterEach(() => _reiniciarPluginsParaPruebas())

  it('reconoce nombres actuales y heredados de JasWaveFx; ignora plugins de terceros', () => {
    assert.equal(idPluginDeInstancia({ nombre: 'JasWave EQ Parametric Pro' }, catalogo), 'com.jaswave.plugin.param-eq')
    assert.equal(idPluginDeInstancia({ nombre: 'JasWave Compresor' }, catalogo), 'com.jaswave.plugin.bus-compressor')
    assert.equal(idPluginDeInstancia({ nombre: 'JasWave Piano' }, catalogo), 'com.jaswave.plugin.piano-synth')
    assert.equal(idPluginDeInstancia({ nombre: 'Serum' }, catalogo), null)
  })

  it('lista solo lo que falta y está en el catálogo, sin duplicados', () => {
    const faltan = pluginsFaltantes(proyecto([['JasWave EQ', 'Serum'], ['JasWave EQ Parametric Pro']], ['JasWave Compresor']), catalogo)
    assert.deepEqual(faltan.map((f) => f.id).sort(), ['com.jaswave.plugin.bus-compressor', 'com.jaswave.plugin.param-eq'])
  })

  it('un plugin ya instalado con binario no se vuelve a pedir', () => {
    activarPaquetes([
      {
        dir: 'x',
        integridad: 'verificada',
        rutaDsp: 'C:/VST3/JasWaveParamEq.vst3',
        manifiesto: {
          id: 'com.jaswave.plugin.param-eq',
          name: 'JasWave EQ Parametric Pro',
          version: '1.0.0',
          category: 'audio-effect',
          vendor: 'JasWave Audio',
          targetPlatforms: ['win-x64'],
          entrypoints: { dspDesktop: 'bin/JasWaveParamEq.vst3' },
          vst3: { classId: '{4A617357-4658-4551-5072-6F6356335431}' },
          permissions: {},
          rolesAllowed: ['mezcla'],
        },
      },
    ])
    assert.deepEqual(pluginsFaltantes(proyecto([['JasWave EQ']]), catalogo), [])
  })

  it('instala en serie, informa errores por plugin y recarga una sola vez si algo se instaló', async () => {
    const orden: string[] = []
    let recargas = 0
    const r = await instalarPlugins(['a', 'b', 'c'], {
      instalar: async (id) => {
        orden.push(id)
        if (id === 'b') return { ok: false, error: 'SHA-256 no coincide' }
        if (id === 'c') throw new Error('sin red')
        return { ok: true }
      },
      recargar: async () => {
        recargas++
      },
    })
    assert.deepEqual(orden, ['a', 'b', 'c'])
    assert.deepEqual(r, { a: { ok: true }, b: { ok: false, error: 'SHA-256 no coincide' }, c: { ok: false, error: 'sin red' } })
    assert.equal(recargas, 1)
    assert.equal((await instalarPlugins(['b'], { instalar: async () => ({ ok: false }), recargar: async () => { recargas++ } })).b?.ok, false)
    assert.equal(recargas, 1)
  })
})

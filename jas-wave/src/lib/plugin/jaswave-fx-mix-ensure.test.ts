/**
 * ensureJasWaveFxOnTrack reutiliza el EQ/compresor de la pista en vez de insertar otro en cada llamada.
 * Ejecutar: npx tsx --test src/lib/plugin/jaswave-fx-mix-ensure.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../../shared/src/index'
import { ensureJasWaveFxOnTrack, findJasWaveFxDescriptor, validarCambiosEq } from './jaswave-fx-mix'
import { pluginRegistry } from './registry'

describe('validarCambiosEq', () => {
  it('convierte texto numérico y explica los valores fuera de rango', () => {
    assert.deepEqual(validarCambiosEq({ freq: '200' as unknown as number, gain: -3 }), { cambios: { freq: 200, gain: -3 } })
    const r = validarCambiosEq({ freq: 50000, q: 'ancho' as unknown as number })
    assert.ok('error' in r)
    assert.match(r.error, /freq 50000 fuera de rango \(20 a 20000\)/)
    assert.match(r.error, /q debe ser un número/)
  })
})

describe('ensureJasWaveFxOnTrack', () => {
  it('dos llamadas seguidas dejan un solo EQ en la pista', async () => {
    if (!findJasWaveFxDescriptor('eq')) {
      pluginRegistry.register({
        pluginId: 'test.eq',
        name: 'JasWave EQ Parametric Pro',
        path: 'C:/VST3/JasWave EQ.vst3',
        format: 'vst3',
        category: 'eq',
        isInstrument: false,
        isEffect: true,
        vendor: 'JasWave',
        version: '1',
        hostReady: true,
        scanStatus: 'ok',
      } as never)
    }
    const d = findJasWaveFxDescriptor('eq')
    assert.ok(d, 'descriptor de EQ disponible')
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi', id: 'p1' }, 'user')
    const a = await ensureJasWaveFxOnTrack(tienda, 'p1', 'eq')
    const b = await ensureJasWaveFxOnTrack(tienda, 'p1', 'eq')
    const eqs = tienda.obtenerEstado().project.tracks[0]!.plugins.filter((p) => p.nombre === d!.name)
    assert.equal(eqs.length, 1)
    assert.equal(a?.slotId, b?.slotId)
  })
})

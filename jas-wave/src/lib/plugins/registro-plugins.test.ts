/**
 * npx tsx --test src/lib/plugins/registro-plugins.test.ts
 */
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { agentActionClassOfType, registroHerramientasPlugins } from '@jaswave/ai-harness'
import {
  _reiniciarPluginsParaPruebas,
  activarPaquetes,
  cargarPluginsInstalados,
  configurarLicenciasPlugins,
  desactivarPlugin,
  planificarHerramientaPlugin,
  type PaqueteRecibido,
} from './registro-plugins'

const manifiesto = (id = 'com.jaswave.plugin.param-eq') => ({
  id,
  name: 'JasWave EQ',
  version: '1.0.0',
  category: 'audio-effect',
  vendor: 'JasWave Audio',
  targetPlatforms: ['win-x64'],
  entrypoints: { dspDesktop: 'bin/JasWaveParamEq.vst3' },
  vst3: { classId: '{4A15A3A0-3C1A-4C4F-B19A-8E40280D5E01}' },
  permissions: { realtimeAudio: true, fileSystem: 'none', network: false, commands: ['plugin.setParameter'] },
  rolesAllowed: ['mezcla'],
  license: { productId: id, features: [{ key: 'eq.avanzado' }] },
  ai: {
    summary: 'EQ',
    parameters: [
      { id: 'b1.gain', vstParamId: 3, name: 'Banda 1 Ganancia', min: -24, max: 24, default: 0, unit: 'dB' },
      { id: 'b5.gain', vstParamId: 23, name: 'Banda 5 Ganancia', min: -24, max: 24, default: 0, unit: 'dB', feature: 'eq.avanzado' },
    ],
  },
})

const paquete = (extra: Partial<PaqueteRecibido> = {}): PaqueteRecibido => ({
  dir: 'C:/x/com.jaswave.plugin.param-eq',
  manifiesto: manifiesto(),
  integridad: 'verificada',
  ...extra,
})

describe('plugins activos (P1/P2 en el DAW)', () => {
  afterEach(() => _reiniciarPluginsParaPruebas())

  it('un paquete válido expone sus herramientas al rol permitido y no a otros', () => {
    const r = activarPaquetes([paquete()])
    assert.equal(r.activos.length, 1)
    const mezcla = registroHerramientasPlugins.listar('mezcla').map((t) => t.name)
    assert.ok(mezcla.includes('plugin.param-eq.ajustar'))
    assert.ok(mezcla.includes('plugin.param-eq.describir'))
    const productor = registroHerramientasPlugins.listar('productor').map((t) => t.name)
    assert.ok(!productor.includes('plugin.param-eq.ajustar'))
  })


  it('rechaza paquetes alterados, manifiestos inválidos e ids duplicados', () => {
    const r = activarPaquetes([
      paquete({ integridad: 'alterada', discrepancias: ['bin/x.vst3'] }),
      paquete({ dir: 'b', manifiesto: { id: 'roto' } }),
      paquete({ dir: 'c', manifiesto: manifiesto('com.jaswave.plugin.otro') }),
      paquete({ dir: 'd', manifiesto: manifiesto('com.jaswave.plugin.otro') }),
    ])
    assert.deepEqual(r.activos.map((a) => a.manifiesto.id), ['com.jaswave.plugin.otro'])
    assert.equal(r.rechazados.length, 3)
    assert.match(r.rechazados[0]!.motivo, /integridad alterada/)
    assert.match(r.rechazados[1]!.motivo, /manifiesto inválido/)
    assert.match(r.rechazados[2]!.motivo, /duplicado/)
  })

  it('ajustar se traduce a plugin.setParameter con el ParamID VST3', () => {
    activarPaquetes([paquete()])
    const plan = planificarHerramientaPlugin('plugin.param-eq.ajustar', { trackId: 't1', pluginInstanceId: 'p1', valores: { 'b1.gain': -6 } })
    assert.equal(plan.tipo, 'comandos')
    assert.deepEqual(plan.tipo === 'comandos' && plan.llamadas, [
      { tool: 'plugin.setParameter', arguments: { trackId: 't1', pluginInstanceId: 'p1', parameterId: '3', normalizedValue: 0.375, plainValue: -6, name: 'Banda 1 Ganancia' } },
    ])
  })

  it('respeta las funciones concedidas por la licencia', () => {
    activarPaquetes([paquete()])
    configurarLicenciasPlugins(() => [])
    assert.throws(
      () => planificarHerramientaPlugin('plugin.param-eq.ajustar', { trackId: 't', pluginInstanceId: 'p', valores: { 'b5.gain': 3 } }),
      /licencia/,
    )
  })

  it('al desactivar (p. ej. cuarentena) la herramienta desaparece y queda sin clase (fail-closed)', () => {
    activarPaquetes([paquete()])
    assert.equal(agentActionClassOfType('plugin.param-eq.ajustar'), 'write')
    desactivarPlugin('com.jaswave.plugin.param-eq')
    assert.equal(agentActionClassOfType('plugin.param-eq.ajustar'), undefined)
    assert.throws(() => planificarHerramientaPlugin('plugin.param-eq.describir', {}), /no disponible/)
  })

  it('cargarPluginsInstalados usa el listado del proceso main', async () => {
    const r = await cargarPluginsInstalados(async () => [paquete()])
    assert.equal(r.activos.length, 1)
    assert.deepEqual(await cargarPluginsInstalados(undefined), { activos: [], rechazados: [] })
  })
})

describe('K1 — catálogo del DAW desde manifiestos', () => {
  afterEach(() => _reiniciarPluginsParaPruebas())

  it('un plugin con binario aparece en el catálogo con los datos del manifiesto y sustituye la entrada heredada', async () => {
    const { pluginRegistry } = await import('../plugin/registry')
    pluginRegistry.register({
      pluginId: 'vst3.legado',
      format: 'vst3',
      vendor: 'JasWave',
      name: 'JasWave EQ',
      version: '0.9.0',
      path: 'C:/viejo/JasWaveFx.vst3',
      category: 'efecto',
      isInstrument: false,
      isEffect: true,
      supportsMidiInput: false,
      supportsMidiOutput: false,
      supportsAudioInput: true,
      supportsAudioOutput: true,
      supportsSidechain: false,
      supportsEditor: true,
      parameterCount: 42,
      scanStatus: 'ok',
      hostReady: true,
      isolation: 'out-of-process',
    })
    activarPaquetes([paquete({ rutaDsp: 'C:/VST3/JasWaveParamEq.vst3' })])
    const d = pluginRegistry.findById('jaswave:com.jaswave.plugin.param-eq')
    assert.equal(d?.path, 'C:/VST3/JasWaveParamEq.vst3')
    assert.equal(d?.isEffect, true)
    assert.equal(d?.uniqueId, '{4A15A3A0-3C1A-4C4F-B19A-8E40280D5E01}')
    assert.equal(pluginRegistry.findById('vst3.legado'), undefined)
    desactivarPlugin('com.jaswave.plugin.param-eq')
    assert.equal(pluginRegistry.findById('jaswave:com.jaswave.plugin.param-eq'), undefined)
  })

  it('sin binario disponible no se añade al catálogo (pero sí sus herramientas de IA)', async () => {
    const { pluginRegistry } = await import('../plugin/registry')
    activarPaquetes([paquete()])
    assert.equal(pluginRegistry.findById('jaswave:com.jaswave.plugin.param-eq'), undefined)
  })
})

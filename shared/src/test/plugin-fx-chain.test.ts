/**
 * Tests FX Chain — comandos plugin.* (ADR-0012).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { crearTiendaDAW, crearEstadoInicial } from '../state'
import type { PluginInfo } from '../types/entidades'

function softPad(): PluginInfo {
  return {
    id: `plugin-softpad-test`,
    nombre: 'JasWave Soft Pad',
    fabricante: 'JasWave',
    tipo: 'instrumento',
    bypass: false,
    parametros: [],
    estado: 'cargado',
    version: '1.0.0',
    wet: 1,
    latencia: 0,
    categoria: 'synth',
    autor: 'JasWave',
    licencia: 'interno',
    descripcion: 'test',
    ui: { ancho: 320, alto: 180, personalizable: false },
  }
}

function eqPlugin(id = 'plugin-eq'): PluginInfo {
  return {
    ...softPad(),
    id,
    nombre: 'EQ',
    tipo: 'efecto',
    categoria: 'efecto',
    estado: 'pendiente',
    licencia: 'VST3',
  }
}

describe('plugin FX chain commands', () => {
  let tienda: ReturnType<typeof crearTiendaDAW>
  let trackId: string

  beforeEach(async () => {
    tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await tienda.executor.execute('track.create', { nombre: 'Vocal', tipo: 'midi' })
    const tracks = tienda.obtenerEstado().project.tracks
    trackId = tracks[tracks.length - 1]!.id
  })

  it('insert move bypass duplicate remove', async () => {
    await tienda.executor.execute('plugin.insert', {
      trackId,
      plugin: softPad(),
      position: 0,
    })
    let plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins).toHaveLength(1)

    await tienda.executor.execute('plugin.insert', {
      trackId,
      plugin: eqPlugin(),
      position: 1,
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins.map((p) => p.nombre)).toEqual(['JasWave Soft Pad', 'EQ'])

    await tienda.executor.execute('plugin.move', {
      trackId,
      pluginInstanceId: 'plugin-eq',
      toIndex: 0,
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins.map((p) => p.nombre)).toEqual(['EQ', 'JasWave Soft Pad'])

    await tienda.executor.execute('plugin.bypass', {
      trackId,
      pluginInstanceId: 'plugin-eq',
      bypass: true,
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins[0]!.bypass).toBe(true)

    await tienda.executor.execute('plugin.duplicate', {
      trackId,
      pluginInstanceId: 'plugin-eq',
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins).toHaveLength(3)
    expect(plugins[1]!.nombre).toContain('copia')
    expect(plugins[1]!.id).not.toBe('plugin-eq')

    await tienda.executor.execute('plugin.remove', {
      trackId,
      pluginInstanceId: plugins[1]!.id,
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins).toHaveLength(2)
  })

  it('replace setParameter copy paste master chain', async () => {
    await tienda.executor.execute('plugin.insert', {
      trackId,
      plugin: eqPlugin('plugin-eq-a'),
    })
    await tienda.executor.execute('plugin.replace', {
      trackId,
      pluginInstanceId: 'plugin-eq-a',
      plugin: eqPlugin('plugin-eq-b'),
    })
    let plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins).toHaveLength(1)
    expect(plugins[0]!.id).toBe('plugin-eq-b')

    await tienda.executor.execute('plugin.setParameter', {
      trackId,
      pluginInstanceId: 'plugin-eq-b',
      parameterId: 'gain',
      normalizedValue: 0.42,
      name: 'Gain',
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins[0]!.parametros.some((x) => x.id === 'gain' && x.valor === 0.42)).toBe(true)

    await tienda.executor.execute('fxChain.copy', { trackId })
    await tienda.executor.execute('fxChain.paste', {
      trackId: 'master',
      plugins: plugins.map((p) => ({ ...p })),
    })
    const masterPlugs = tienda.obtenerEstado().project.master.plugins ?? []
    expect(masterPlugs.length).toBeGreaterThanOrEqual(1)
    expect(masterPlugs[0]!.id).not.toBe('plugin-eq-b')

    await tienda.executor.execute('fxChain.loadPreset', {
      trackId,
      presetId: 'vocal-clean',
      nombre: 'Vocal Clean',
      plugins: [eqPlugin('missing-comp'), softPad()],
    })
    plugins = tienda.obtenerEstado().project.tracks.find((t) => t.id === trackId)!.plugins
    expect(plugins).toHaveLength(2)
  })
})

describe('automation param key', () => {
  it('roundtrips plugin instance + parameter', async () => {
    const { automationParamKey, parseAutomationParamKey } = await import(
      '../commands/plugin-commands'
    )
    const key = automationParamKey('inst-1', 'threshold')
    expect(key).toBe('plugin:inst-1:threshold')
    expect(parseAutomationParamKey(key)).toEqual({
      pluginInstanceId: 'inst-1',
      parameterId: 'threshold',
    })
  })
})

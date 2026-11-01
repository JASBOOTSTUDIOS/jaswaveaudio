/**
 * FX Chain: undo/redo exactos y validación de plugin.remove / plugin.bypass / plugin.setParameter.
 * (plugin-fx-chain.test.ts solo cubre el camino feliz.)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { crearEstadoInicial, crearTiendaDAW } from '../state'
import type { PluginInfo } from '../types/entidades'

function plugin(id: string, nombre: string, extra: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id,
    nombre,
    fabricante: 'JasWave',
    tipo: 'efecto',
    bypass: false,
    parametros: [],
    estado: 'cargado',
    version: '1.0.0',
    wet: 1,
    latencia: 0,
    categoria: 'efecto',
    autor: 'JasWave',
    licencia: 'interno',
    descripcion: 'test',
    ui: { ancho: 320, alto: 180, personalizable: false },
    ...extra,
  }
}

describe('plugin.* — undo exacto y validación', () => {
  let t: ReturnType<typeof crearTiendaDAW>
  let trackId: string
  const cadena = () => t.obtenerEstado().project.tracks.find((x) => x.id === trackId)!.plugins

  beforeEach(async () => {
    t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await t.executor.execute('track.create', { nombre: 'Guitarra', tipo: 'midi' })
    const tracks = t.obtenerEstado().project.tracks
    trackId = tracks[tracks.length - 1]!.id
    for (const [i, nombre] of ['EQ', 'Comp', 'Verb'].entries()) {
      await t.executor.execute('plugin.insert', { trackId, plugin: plugin(`p${i}`, nombre), position: i })
    }
  })

  it('plugin.remove restaura el plugin en el MISMO índice con su estado completo al deshacer', async () => {
    await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p1', parameterId: 'ratio', normalizedValue: 0.4 })
    const antes = JSON.parse(JSON.stringify(cadena()))
    const r = await t.executor.execute('plugin.remove', { trackId, pluginInstanceId: 'p1' })
    expect(r.success).toBe(true)
    expect(cadena().map((p) => p.id)).toEqual(['p0', 'p2'])
    await t.executor.undo()
    expect(JSON.parse(JSON.stringify(cadena()))).toEqual(antes)
    expect(cadena().map((p) => p.id)).toEqual(['p0', 'p1', 'p2'])
    await t.executor.redo()
    expect(cadena().map((p) => p.id)).toEqual(['p0', 'p2'])
  })

  it('plugin.bypass se puede deshacer y rehacer', async () => {
    await t.executor.execute('plugin.bypass', { trackId, pluginInstanceId: 'p2', bypass: true })
    expect(cadena().find((p) => p.id === 'p2')!.bypass).toBe(true)
    await t.executor.undo()
    expect(cadena().find((p) => p.id === 'p2')!.bypass).toBe(false)
    await t.executor.redo()
    expect(cadena().find((p) => p.id === 'p2')!.bypass).toBe(true)
  })

  it('plugin.setParameter acota normalizedValue a 0..1', async () => {
    await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p0', parameterId: 'gain', normalizedValue: 5 })
    expect(cadena()[0]!.parametros.find((p) => p.id === 'gain')!.valor).toBe(1)
    await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p0', parameterId: 'gain', normalizedValue: -3 })
    expect(cadena()[0]!.parametros.find((p) => p.id === 'gain')!.valor).toBe(0)
  })

  it('plugin.setParameter rechaza valores no finitos y parameterId vacío', async () => {
    const nan = await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p0', parameterId: 'gain', normalizedValue: Number.NaN })
    expect(nan.success).toBe(false)
    const vacio = await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p0', parameterId: '  ', normalizedValue: 0.5 })
    expect(vacio.success).toBe(false)
    expect(cadena()[0]!.parametros).toHaveLength(0)
  })

  it('el undo de un parámetro NUEVO lo elimina (antes lo dejaba creado con valor 0)', async () => {
    expect(cadena()[0]!.parametros).toHaveLength(0)
    await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'p0', parameterId: 'gain', normalizedValue: 0.7 })
    expect(cadena()[0]!.parametros).toHaveLength(1)
    await t.executor.undo()
    expect(cadena()[0]!.parametros).toHaveLength(0)
    await t.executor.redo()
    expect(cadena()[0]!.parametros.find((p) => p.id === 'gain')!.valor).toBeCloseTo(0.7)
  })

  it('al buscar por nombre se conserva el id real del parámetro y el undo lo deja como estaba', async () => {
    t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await t.executor.execute('track.create', { nombre: 'Bajo', tipo: 'midi' })
    const tr = t.obtenerEstado().project.tracks
    trackId = tr[tr.length - 1]!.id
    await t.executor.execute('plugin.insert', {
      trackId,
      position: 0,
      plugin: plugin('eq', 'EQ', {
        parametros: [{ id: '1001', nombre: 'Frecuencia', valor: 0.25, minimo: 0, maximo: 1, paso: 0.01, unidad: 'Hz', etiqueta: 'Frecuencia' }],
      }),
    })
    await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'eq', parameterId: 'Frecuencia', normalizedValue: 0.8 })
    const p = cadena()[0]!.parametros
    expect(p).toHaveLength(1)
    expect(p[0]!.id).toBe('1001') // no se sobrescribe con el nombre
    expect(p[0]!.valor).toBeCloseTo(0.8)
    expect(p[0]!.unidad).toBe('Hz')
    await t.executor.undo()
    expect(cadena()[0]!.parametros[0]).toMatchObject({ id: '1001', nombre: 'Frecuencia', valor: 0.25, unidad: 'Hz' })
  })

  it('un plugin inexistente es un error y no cambia nada', async () => {
    const r = await t.executor.execute('plugin.setParameter', { trackId, pluginInstanceId: 'no-existe', parameterId: 'x', normalizedValue: 0.5 })
    expect(r.success).toBe(false)
  })
})

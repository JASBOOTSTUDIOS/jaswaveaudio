/**
 * WS-4d/e — undo/redo determinista, merge/split, cola serial, batch atómico,
 * simulateBatch puro y crecimiento acotado.
 */

import { describe, it, expect, vi } from 'vitest'
import { crearTiendaDAW } from '../state/tienda'
import { crearEstadoInicial } from '../state/estado-inicial'
import { CommandExecutor } from '../state/ejecutor-comandos'
import { crearPilaDeshacerRehacer } from '../state/pila-deshacer-rehacer'
import { crearRegistroComandos } from '../state/registro-comandos'
import { registrarComandosBuiltin } from '../state/comandos-builtin'
import { crearRegistroAuditoria } from '../state/registro-auditoria'
import { crearTransactionManager } from '../state/gestor-transacciones'
import { BusEventosMemoria, crearSessionScope } from '../events/event-bus'
import type { DAWState } from '../types/state'
import type { PluginInfo } from '../types/entidades'
import type { AuditLog } from '../state/registro-auditoria'

type Tienda = ReturnType<typeof crearTiendaDAW>

function plugin(id = '', nombre = 'EQ'): PluginInfo {
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
  }
}

/** Huella estructural (ids de pistas, clips, notas y plugins). */
function huella(estado: DAWState): string {
  return JSON.stringify({
    tracks: estado.project.tracks.map((t) => ({
      id: t.id,
      clips: (t.clips as { id: string; notas?: { id: string }[] }[]).map((c) => ({
        id: c.id,
        notas: (c.notas ?? []).map((n) => n.id),
      })),
      plugins: (t.plugins ?? []).map((p) => p.id),
    })),
    master: (estado.project.master.plugins ?? []).map((p) => p.id),
  })
}

function nuevaTienda(): Tienda {
  return crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
}

async function ok(tienda: Tienda, type: string, payload: unknown) {
  const r = await tienda.executor.execute(type, payload)
  expect(r.error?.message ?? '').toBe('')
  expect(r.success).toBe(true)
  return r
}

async function crearPistaMidi(tienda: Tienda): Promise<string> {
  const r = await ok(tienda, 'track.create', { nombre: 'Synth', tipo: 'midi' })
  return (r.result as { trackId: string }).trackId
}

async function crearClipMidi(tienda: Tienda, pistaId: string, inicio = 0, duracion = 8): Promise<string> {
  const r = await ok(tienda, 'midi.clip.create', {
    pistaId,
    inicio,
    duracion,
    notas: [
      { pitch: 60, inicio: 0, duracion: 1 },
      { pitch: 62, inicio: 3.5, duracion: 1 },
      { pitch: 64, inicio: 6, duracion: 1 },
    ],
  })
  return (r.result as { clipId: string }).clipId
}

/** Ejecuta el comando y verifica undo → redo → undo → redo con ids estables. */
async function verificarCicloUndoRedo(tienda: Tienda, type: string, payload: unknown) {
  const antes = huella(tienda.obtenerEstado())
  await ok(tienda, type, payload)
  const despues = huella(tienda.obtenerEstado())
  expect(despues).not.toBe(antes)

  for (let i = 0; i < 2; i++) {
    const u = await tienda.executor.undo()
    expect(u.error?.message ?? '').toBe('')
    expect(huella(tienda.obtenerEstado())).toBe(antes)
    const r = await tienda.executor.redo()
    expect(r.error?.message ?? '').toBe('')
    expect(huella(tienda.obtenerEstado())).toBe(despues)
  }
  const u = await tienda.executor.undo()
  expect(u.success).toBe(true)
  expect(huella(tienda.obtenerEstado())).toBe(antes)
}

describe('redo determinista en comandos que generan ids', () => {
  it('track.create devuelve trackId y mantiene id en redo', async () => {
    const tienda = nuevaTienda()
    const r = await ok(tienda, 'track.create', { nombre: 'A', tipo: 'midi' })
    const trackId = (r.result as { trackId: string; nombre: string }).trackId
    expect((r.result as { nombre: string }).nombre).toBe('A')
    expect(tienda.obtenerEstado().project.tracks.some((t) => t.id === trackId)).toBe(true)
    await tienda.executor.undo()
    await tienda.executor.redo()
    expect(tienda.obtenerEstado().project.tracks.slice(-1)[0]?.id).toBe(trackId)
    await verificarCicloUndoRedo(tienda, 'track.create', { nombre: 'B', tipo: 'audio' })
  })

  it('track.create acepta id fijado y rechaza duplicados', async () => {
    const tienda = nuevaTienda()
    await ok(tienda, 'track.create', { nombre: 'A', id: 'pista-fija' })
    expect(tienda.obtenerEstado().project.tracks.slice(-1)[0]?.id).toBe('pista-fija')
    const dup = await tienda.executor.execute('track.create', { nombre: 'B', id: 'pista-fija' })
    expect(dup.success).toBe(false)
  })

  it('clip.create', async () => {
    const tienda = nuevaTienda()
    const r = await ok(tienda, 'track.create', { nombre: 'Audio', tipo: 'audio' })
    const pistaId = (r.result as { trackId: string }).trackId
    await verificarCicloUndoRedo(tienda, 'clip.create', { pistaId, inicio: 0, duracion: 4 })
  })

  it('midi.clip.create (clip y notas)', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    await verificarCicloUndoRedo(tienda, 'midi.clip.create', {
      pistaId,
      notas: [
        { pitch: 60, inicio: 0, duracion: 1 },
        { pitch: 67, inicio: 1, duracion: 1 },
      ],
    })
  })

  it('midi.generatePattern (clip nuevo)', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    await verificarCicloUndoRedo(tienda, 'midi.generatePattern', { pistaId, kind: 'bass_funk', bars: 2, seed: 7 })
  })

  it('midi.generatePattern sobre clip existente: undo restaura notas, no borra el clip', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    const clipId = await crearClipMidi(tienda, pistaId)
    await verificarCicloUndoRedo(tienda, 'midi.generatePattern', { pistaId, clipId, kind: 'arp', bars: 2, seed: 3 })
    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.id === pistaId)!
    expect((pista.clips as { id: string }[]).map((c) => c.id)).toEqual([clipId])
  })

  it('plugin.insert sin id', async () => {
    const tienda = nuevaTienda()
    const trackId = await crearPistaMidi(tienda)
    await verificarCicloUndoRedo(tienda, 'plugin.insert', { trackId, plugin: plugin('') })
  })

  it('plugin.duplicate', async () => {
    const tienda = nuevaTienda()
    const trackId = await crearPistaMidi(tienda)
    await ok(tienda, 'plugin.insert', { trackId, plugin: plugin('plugin-src') })
    await verificarCicloUndoRedo(tienda, 'plugin.duplicate', { trackId, pluginInstanceId: 'plugin-src' })
  })

  it('plugin.replace sin id', async () => {
    const tienda = nuevaTienda()
    const trackId = await crearPistaMidi(tienda)
    await ok(tienda, 'plugin.insert', { trackId, plugin: plugin('plugin-old') })
    await verificarCicloUndoRedo(tienda, 'plugin.replace', {
      trackId,
      pluginInstanceId: 'plugin-old',
      plugin: plugin('', 'Comp'),
    })
  })

  it('fxChain.paste', async () => {
    const tienda = nuevaTienda()
    const trackId = await crearPistaMidi(tienda)
    await verificarCicloUndoRedo(tienda, 'fxChain.paste', { trackId, plugins: [plugin('a'), plugin('b')] })
  })

  it('fxChain.loadPreset con plugins sin id', async () => {
    const tienda = nuevaTienda()
    const trackId = await crearPistaMidi(tienda)
    await ok(tienda, 'plugin.insert', { trackId, plugin: plugin('plugin-prev') })
    await verificarCicloUndoRedo(tienda, 'fxChain.loadPreset', {
      trackId,
      presetId: 'p1',
      nombre: 'Preset',
      plugins: [plugin(''), plugin('', 'Reverb')],
    })
  })

  it('cadena: crear pista + clip, deshacer todo y rehacer todo conserva ids', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    await crearClipMidi(tienda, pistaId)
    const final = huella(tienda.obtenerEstado())
    await tienda.executor.undo()
    await tienda.executor.undo()
    expect(tienda.obtenerEstado().project.tracks).toHaveLength(0)
    expect((await tienda.executor.redo()).success).toBe(true)
    expect((await tienda.executor.redo()).success).toBe(true)
    expect(huella(tienda.obtenerEstado())).toBe(final)
  })
})

describe('undo de clip.merge / clip.split / midi.clip.splitIntoSections', () => {
  it('clip.merge (MIDI) restaura los clips originales', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    const a = await crearClipMidi(tienda, pistaId, 0, 4)
    const b = await crearClipMidi(tienda, pistaId, 4, 4)
    await verificarCicloUndoRedo(tienda, 'clip.merge', { pistaId, clipIds: [a, b] })
    const pista = tienda.obtenerEstado().project.tracks.find((t) => t.id === pistaId)!
    expect((pista.clips as { id: string }[]).map((c) => c.id)).toEqual([a, b])
  })

  it('clip.merge (audio)', async () => {
    const tienda = nuevaTienda()
    const r = await ok(tienda, 'track.create', { nombre: 'Audio', tipo: 'audio' })
    const pistaId = (r.result as { trackId: string }).trackId
    const c1 = await ok(tienda, 'clip.create', { pistaId, inicio: 0, duracion: 2 })
    const c2 = await ok(tienda, 'clip.create', { pistaId, inicio: 2, duracion: 2 })
    await verificarCicloUndoRedo(tienda, 'clip.merge', {
      pistaId,
      clipIds: [(c1.result as { clipId: string }).clipId, (c2.result as { clipId: string }).clipId],
    })
  })

  it('clip.split (MIDI) es deshacible', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    const clipId = await crearClipMidi(tienda, pistaId)
    const notasAntes = JSON.stringify(
      (tienda.obtenerEstado().project.tracks[0]!.clips[0] as { notas: unknown[] }).notas,
    )
    await verificarCicloUndoRedo(tienda, 'clip.split', { pistaId, clipId, tiempo: 4 })
    const clips = tienda.obtenerEstado().project.tracks[0]!.clips as { id: string; duracion: number; notas: unknown[] }[]
    expect(clips).toHaveLength(1)
    expect(clips[0]!.id).toBe(clipId)
    expect(clips[0]!.duracion).toBe(8)
    expect(JSON.stringify(clips[0]!.notas)).toBe(notasAntes)
  })

  it('clip.split (audio) es deshacible', async () => {
    const tienda = nuevaTienda()
    const r = await ok(tienda, 'track.create', { nombre: 'Audio', tipo: 'audio' })
    const pistaId = (r.result as { trackId: string }).trackId
    const c = await ok(tienda, 'clip.create', { pistaId, inicio: 0, duracion: 4 })
    await verificarCicloUndoRedo(tienda, 'clip.split', { pistaId, clipId: (c.result as { clipId: string }).clipId, tiempo: 1 })
  })

  it('midi.clip.splitIntoSections es deshacible', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    const clipId = await crearClipMidi(tienda, pistaId)
    await verificarCicloUndoRedo(tienda, 'midi.clip.splitIntoSections', { pistaId, clipId, cuts: [2, 5] })
    const clips = tienda.obtenerEstado().project.tracks[0]!.clips as { id: string }[]
    expect(clips.map((c) => c.id)).toEqual([clipId])
  })
})

describe('cola serial del executor', () => {
  it('execute concurrentes no pierden actualizaciones', async () => {
    const tienda = nuevaTienda()
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => tienda.executor.execute('track.create', { nombre: `T${i}`, tipo: 'midi' })),
    )
    const tracks = tienda.obtenerEstado().project.tracks
    expect(tracks).toHaveLength(20)
    expect(tracks.map((t) => t.nombre)).toEqual(Array.from({ length: 20 }, (_, i) => `T${i}`))
    expect(tienda.executor.getUndoDepth()).toBe(20)
  })

  it('undo/redo/execute intercalados se aplican en orden', async () => {
    const tienda = nuevaTienda()
    const p = [
      tienda.executor.execute('track.create', { nombre: 'A' }),
      tienda.executor.execute('track.create', { nombre: 'B' }),
      tienda.executor.undo(),
      tienda.executor.execute('track.create', { nombre: 'C' }),
      tienda.executor.batch([
        { type: 'track.create', payload: { nombre: 'D' } },
        { type: 'track.create', payload: { nombre: 'E' } },
      ]),
    ]
    await Promise.all(p)
    expect(tienda.obtenerEstado().project.tracks.map((t) => t.nombre)).toEqual(['A', 'C', 'D', 'E'])
  })
})

describe('batch atómico', () => {
  it('rollback no emite eventos de dominio, ni historial, ni undo, ni notifica', async () => {
    const tienda = nuevaTienda()
    await ok(tienda, 'track.create', { nombre: 'Base' })
    const estado = tienda.obtenerEstado()
    const replayAntes = tienda.busEventos.obtenerBufferReplay().length
    const historialAntes = tienda.executor.getHistory().length
    const depthAntes = tienda.executor.getUndoDepth()
    const creadas = vi.fn()
    tienda.busEventos.on('track.creada', creadas)
    const listener = vi.fn()
    tienda.suscribir(listener)

    const r = await tienda.executor.batch([
      { type: 'track.create', payload: { nombre: 'X' } },
      { type: 'track.create', payload: { nombre: 'Y' } },
      { type: 'track.delete', payload: { trackId: 'no-existe' } },
    ])
    expect(r.success).toBe(false)
    expect(r.rolledBack).toBe(true)
    expect(creadas).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
    expect(tienda.obtenerEstado()).toBe(estado)
    expect(tienda.executor.getHistory()).toHaveLength(historialAntes)
    expect(tienda.executor.getUndoDepth()).toBe(depthAntes)
    const nuevos = tienda.busEventos.obtenerBufferReplay().slice(replayAntes)
    expect(nuevos.map((e) => e.nombre)).toEqual(['comando.fallido'])
  })

  it('éxito deja una sola entrada de undo que revierte todo el batch', async () => {
    const tienda = nuevaTienda()
    const r = await tienda.executor.batch([
      { type: 'track.create', payload: { nombre: 'X' } },
      { type: 'track.create', payload: { nombre: 'Y' } },
      { type: 'track.create', payload: { nombre: 'Z' } },
    ])
    expect(r.success).toBe(true)
    expect(tienda.executor.getUndoDepth()).toBe(1)
    const tras = huella(tienda.obtenerEstado())
    await tienda.executor.undo()
    expect(tienda.obtenerEstado().project.tracks).toHaveLength(0)
    await tienda.executor.redo()
    expect(huella(tienda.obtenerEstado())).toBe(tras)
  })
})

describe('simulateBatch puro', () => {
  it('no emite eventos, no crece historial/auditoría/undo, no notifica listeners', async () => {
    const tienda = nuevaTienda()
    await ok(tienda, 'track.create', { nombre: 'Base' })
    const estado = tienda.obtenerEstado()
    const auditoria = (tienda.executor as unknown as { auditoria: AuditLog }).auditoria
    const replayAntes = tienda.busEventos.obtenerBufferReplay().length
    const historialAntes = tienda.executor.getHistory().length
    const auditAntes = auditoria.list().length
    const depthAntes = tienda.executor.getUndoDepth()
    const listener = vi.fn()
    tienda.suscribir(listener)

    const sim = await tienda.executor.simulateBatch([
      { type: 'track.create', payload: { nombre: 'Sim' } },
      { type: 'project.setBpm', payload: { bpm: 90 } },
    ])
    expect(sim.success).toBe(true)
    expect(sim.results).toHaveLength(2)
    expect(sim.stateDiff).toBeDefined()
    expect(tienda.obtenerEstado()).toBe(estado)
    expect(tienda.busEventos.obtenerBufferReplay()).toHaveLength(replayAntes)
    expect(tienda.executor.getHistory()).toHaveLength(historialAntes)
    expect(auditoria.list()).toHaveLength(auditAntes)
    expect(tienda.executor.getUndoDepth()).toBe(depthAntes)
    expect(listener).not.toHaveBeenCalled()
  })

  it('TransactionManager: dry-run no deja transacciones abiertas y admite commit posterior', async () => {
    const tienda = nuevaTienda()
    const tm = crearTransactionManager(tienda.executor)
    const tx = tm.begin('preview')
    tm.addCommand(tx, { type: 'track.create', payload: { nombre: 'P' } })
    const dry = await tm.commit(tx, { dryRun: true, source: 'user' })
    expect(dry.success).toBe(true)
    expect(tm.cantidadPendientes()).toBe(0)
    expect(tienda.obtenerEstado().project.tracks).toHaveLength(0)
    const real = await tm.commit(tx, { source: 'user' })
    expect(real.success).toBe(true)
    expect(tienda.obtenerEstado().project.tracks).toHaveLength(1)
  })
})

describe('tienda: reemplazo de estado y notificaciones', () => {
  it('reemplazarEstado y project.new vacían undo/redo; establecerEstado los conserva', async () => {
    const tienda = nuevaTienda()
    await ok(tienda, 'track.create', { nombre: 'A' })
    tienda.establecerEstado((s) => ({ ui: { ...s.ui } }))
    expect(tienda.executor.canUndo()).toBe(true)
    tienda.reemplazarEstado(crearEstadoInicial())
    expect(tienda.executor.canUndo()).toBe(false)
    expect(tienda.executor.canRedo()).toBe(false)

    await ok(tienda, 'track.create', { nombre: 'B' })
    await ok(tienda, 'project.new', { nombre: 'Nuevo' })
    expect(tienda.executor.canUndo()).toBe(false)
  })

  it('despachar notifica una vez y emite un solo comando.fallido', async () => {
    const tienda = nuevaTienda()
    const listener = vi.fn()
    tienda.suscribir(listener)
    await tienda.despachar({ type: 'track.create', payload: { nombre: 'A' } })
    expect(listener).toHaveBeenCalledTimes(1)

    const fallidos = vi.fn()
    tienda.busEventos.on('comando.fallido', fallidos)
    await expect(tienda.despachar({ type: 'track.delete', payload: { trackId: 'nope' } })).rejects.toThrow()
    expect(fallidos).toHaveBeenCalledTimes(1)
  })

  it('no publica registro/bus en globalThis', () => {
    nuevaTienda()
    expect((globalThis as Record<string, unknown>).__jaswaveCommandRegistry).toBeUndefined()
    expect((globalThis as Record<string, unknown>).__jaswaveEventBus).toBeUndefined()
  })

  it('comando sin inverso que cambia el proyecto invalida redo', async () => {
    const tienda = nuevaTienda()
    const pistaId = await crearPistaMidi(tienda)
    await crearClipMidi(tienda, pistaId)
    await tienda.executor.undo()
    expect(tienda.executor.canRedo()).toBe(true)
    // fxChain.pasteUndo no tiene inverseType pero cambia el proyecto.
    expect(tienda.registroComandos.get('fxChain.pasteUndo')?.inverseType).toBeUndefined()
    await ok(tienda, 'fxChain.pasteUndo', { trackId: pistaId, removeIds: [] })
    expect(tienda.executor.canRedo()).toBe(false)
  })
})

describe('crecimiento acotado', () => {
  it('historial del executor es un ring buffer', async () => {
    const registro = crearRegistroComandos()
    registrarComandosBuiltin(registro)
    const bus = new BusEventosMemoria()
    const executor = new CommandExecutor({
      busEventos: bus,
      pila: crearPilaDeshacerRehacer(),
      registro,
      auditoria: crearRegistroAuditoria({ maxEntradas: 4 }),
      estadoInicial: crearEstadoInicial(),
      maxHistorial: 5,
    })
    for (let i = 0; i < 12; i++) {
      await executor.execute('track.create', { nombre: `T${i}` })
    }
    const h = executor.getHistory()
    expect(h).toHaveLength(5)
    expect((h[h.length - 1]!.payload as { nombre: string }).nombre).toBe('T11')
    expect((executor as unknown as { auditoria: AuditLog }).auditoria.list()).toHaveLength(4)
    bus.destruir()
  })

  it('auditoría resume payloads > 64KB', () => {
    const audit = crearRegistroAuditoria()
    audit.log({
      id: '1',
      timestamp: 0,
      commandType: 'x',
      payload: { waveform: 'a'.repeat(70 * 1024), nombre: 'grande' },
      source: 'user',
      result: 'success',
    })
    audit.log({ id: '2', timestamp: 0, commandType: 'y', payload: { nombre: 'chico' }, source: 'user', result: 'success' })
    const [grande, chico] = audit.list()
    expect((grande!.payload as { __resumido?: boolean }).__resumido).toBe(true)
    expect((grande!.payload as { claves: string[] }).claves).toEqual(['waveform', 'nombre'])
    expect(chico!.payload).toEqual({ nombre: 'chico' })
  })

  it('pila de undo de la tienda limitada a 200', async () => {
    const tienda = nuevaTienda()
    for (let i = 0; i < 205; i++) {
      await tienda.executor.execute('track.create', { nombre: `T${i}` })
    }
    expect(tienda.executor.getUndoDepth()).toBe(200)
  })
})

describe('event bus', () => {
  it('cancelar un once no quita un on con el mismo manejador', () => {
    const bus = new BusEventosMemoria()
    const fn = vi.fn()
    bus.on('evento.x', fn)
    const sOnce = bus.once('evento.x', fn)
    sOnce.cancelarSuscripcion()
    bus.emit('evento.x', 1)
    expect(fn).toHaveBeenCalledTimes(1)
    bus.destruir()
  })

  it('cancelar un on no quita un once con el mismo manejador', () => {
    const bus = new BusEventosMemoria()
    const fn = vi.fn()
    const sOn = bus.on('evento.y', fn)
    bus.once('evento.y', fn)
    sOn.cancelarSuscripcion()
    bus.emit('evento.y', 1)
    bus.emit('evento.y', 2)
    expect(fn).toHaveBeenCalledTimes(1)
    bus.destruir()
  })

  it('SessionScope.off cancela solo la suscripción de ese manejador', () => {
    const bus = new BusEventosMemoria()
    const scope = crearSessionScope(bus)
    const a = vi.fn()
    const b = vi.fn()
    scope.on('evento.z', a)
    scope.on('evento.z', b)
    scope.off('evento.z', b)
    bus.emit('evento.z', 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    expect(scope.cantidadSuscripciones()).toBe(1)
    scope.destruir()
    bus.destruir()
  })

  it('SessionScope.off no toca suscripciones ajenas al scope', () => {
    const bus = new BusEventosMemoria()
    const scope = crearSessionScope(bus)
    const ajeno = vi.fn()
    bus.on('evento.w', ajeno)
    scope.off('evento.w', ajeno)
    bus.emit('evento.w', 1)
    expect(ajeno).toHaveBeenCalledTimes(1)
    bus.destruir()
  })

  it('temporizadores perezosos y dispose()', () => {
    const bus = new BusEventosMemoria()
    const interno = bus as unknown as { temporizadorBatch: unknown; temporizadorBajaPrioridad: unknown }
    expect(interno.temporizadorBatch).toBeNull()
    expect(interno.temporizadorBajaPrioridad).toBeNull()
    const fn = vi.fn()
    bus.on('audio.nivelActualizado', fn)
    bus.emit('audio.nivelActualizado', { v: 1 })
    expect(interno.temporizadorBatch).not.toBeNull()
    bus.flushBatch()
    expect(fn).toHaveBeenCalledTimes(1)
    bus.dispose()
    expect(interno.temporizadorBatch).toBeNull()
  })
})

/**
 * npx tsx --test src/lib/gesture-id.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { crearVentanaGesto, nuevoGestureId, opcionesGesto } from './gesture-id'
import { registrarConfirmacionBorrarPista, solicitarBorrarPista } from './track-delete-request'

describe('gesture-id', () => {
  it('nuevoGestureId genera ids distintos', () => {
    assert.notEqual(nuevoGestureId(), nuevoGestureId())
  })

  it('ventana de 600 ms: mismo id mientras los eventos sigan llegando', () => {
    let t = 0
    const gesto = crearVentanaGesto(600, () => t)
    const a = gesto()
    t = 500
    assert.equal(gesto(), a)
    t = 1000 // 500 ms desde el anterior: sigue el mismo gesto
    assert.equal(gesto(), a)
    t = 1700 // 700 ms de pausa: gesto nuevo
    assert.notEqual(gesto(), a)
  })

  it('opcionesGesto sin gesto → sin coalescencia', () => {
    assert.equal(opcionesGesto('k'), undefined)
    assert.deepEqual(opcionesGesto('k', 'g'), { coalesceKey: 'k', gestureId: 'g' })
  })

  it('rueda de BPM: 10 ticks dentro de la ventana = 1 undo', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const inicial = tienda.obtenerEstado().project.bpm.valor
    let t = 0
    const gesto = crearVentanaGesto(600, () => t)
    const depth = tienda.executor.getUndoDepth()
    for (let i = 1; i <= 10; i++) {
      t += 50
      await tienda.executor.execute('project.setBpm', { bpm: inicial + i }, 'user', undefined, opcionesGesto('project.bpm', gesto()))
    }
    assert.equal(tienda.executor.getUndoDepth(), depth + 1)
    await tienda.executor.undo()
    assert.equal(tienda.obtenerEstado().project.bpm.valor, inicial)
  })
})

describe('track-delete-request (Ctrl+Delete)', () => {
  it('con diálogo registrado lo abre y no borra directamente', () => {
    const abiertos: string[] = []
    const borrados: string[] = []
    const baja = registrarConfirmacionBorrarPista((id) => abiertos.push(id))
    solicitarBorrarPista('t1', (id) => borrados.push(id), () => true)
    baja()
    assert.deepEqual(abiertos, ['t1'])
    assert.equal(borrados.length, 0)
  })

  it('sin diálogo usa la confirmación de respaldo', () => {
    const borrados: string[] = []
    solicitarBorrarPista('t1', (id) => borrados.push(id), () => false)
    assert.equal(borrados.length, 0)
    solicitarBorrarPista('t2', (id) => borrados.push(id), () => true)
    assert.deepEqual(borrados, ['t2'])
  })
})

/**
 * npx tsx --test src/lib/save-conflict.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  _reiniciarConflicto,
  obtenerConflictoPendiente,
  responderConflicto,
  solicitarDecisionConflicto,
  suscribirConflicto,
} from './save-conflict'

const conflicto = {
  ruta: 'C:/p.jaswave',
  esperado: { mtimeMs: 1000, size: 10 },
  actual: { mtimeMs: 2000, size: 10 },
}

describe('save-conflict', () => {
  beforeEach(() => _reiniciarConflicto())

  it('no hay conflicto abierto al principio', () => {
    assert.equal(obtenerConflictoPendiente(), null)
  })

  it('la solicitud expone el conflicto y se resuelve con la elección', async () => {
    const promesa = solicitarDecisionConflicto(conflicto)
    assert.deepEqual(obtenerConflictoPendiente(), conflicto)
    responderConflicto('sobrescribir')
    assert.equal(await promesa, 'sobrescribir')
    assert.equal(obtenerConflictoPendiente(), null)
  })

  it('los suscriptores se enteran del cambio', () => {
    let avisos = 0
    const baja = suscribirConflicto(() => {
      avisos += 1
    })
    solicitarDecisionConflicto(conflicto)
    responderConflicto('cancelar')
    baja()
    assert.equal(avisos, 2)
  })

  it('responder sin conflicto abierto no hace nada', () => {
    responderConflicto('cancelar')
    assert.equal(obtenerConflictoPendiente(), null)
  })

  it('dos solicitudes simultáneas comparten la misma promesa', async () => {
    const a = solicitarDecisionConflicto(conflicto)
    const b = solicitarDecisionConflicto({ ...conflicto, ruta: 'C:/otro.jaswave' })
    responderConflicto('guardar-como')
    assert.equal(await a, 'guardar-como')
    assert.equal(await b, 'guardar-como')
  })
})

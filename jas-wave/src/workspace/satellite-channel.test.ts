/**
 * Canal de sincronización entre la ventana principal y las ventanas satélite (U7).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANAL_SINCRONIZACION,
  cerrarCanal,
  enviarMensaje,
  esMensajeSincronizacion,
  obtenerCanal,
} from './satellite-channel'

test('reconoce solo los mensajes del protocolo', () => {
  assert.equal(esMensajeSincronizacion({ type: 'state', state: {} }), true)
  assert.equal(esMensajeSincronizacion({ type: 'request-state' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'ping' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'command', command: 'track.create' }), true)

  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'guardar' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'guardar-como' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'abrir' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'deshacer' }), true)
  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'rehacer' }), true)

  // Se rechaza lo que no es del protocolo (o viene incompleto).
  assert.equal(esMensajeSincronizacion({ type: 'action', action: 'borrar-todo' }), false)
  assert.equal(esMensajeSincronizacion({ type: 'command' }), false)
  assert.equal(esMensajeSincronizacion({ type: 'otro' }), false)
  assert.equal(esMensajeSincronizacion(null), false)
  assert.equal(esMensajeSincronizacion('state'), false)
})

test('el canal de la ventana se reutiliza y se puede cerrar', () => {
  const canal = obtenerCanal()
  assert.ok(canal, 'debe existir BroadcastChannel en el proceso')
  assert.equal(obtenerCanal(), canal, 'se reutiliza la misma instancia')

  cerrarCanal()
  assert.notEqual(obtenerCanal(), canal, 'tras cerrar se crea otro canal')
  cerrarCanal()
})

test('los mensajes llegan a las demás ventanas del canal', async () => {
  const receptor = new BroadcastChannel(CANAL_SINCRONIZACION)
  const recibido = new Promise<unknown>((resolve) => {
    receptor.onmessage = (ev) => {
      receptor.close()
      resolve(ev.data)
    }
  })

  assert.equal(enviarMensaje({ type: 'action', action: 'guardar' }), true)
  assert.deepEqual(await recibido, { type: 'action', action: 'guardar' })
  cerrarCanal()
})

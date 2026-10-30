import { test } from 'node:test'
import assert from 'node:assert/strict'
import { etiquetaMaximizar, modoControlesVentana, planBarraTitulo } from './window-chrome'

test('modoControlesVentana: nativos con overlay, propios sin él, ninguno en web o con marco nativo', () => {
  assert.equal(modoControlesVentana({ esElectron: true, overlayVisible: true }), 'nativos')
  // Pantalla completa / plataforma sin overlay: la UI dibuja los suyos (nunca quedarse sin botones)
  assert.equal(modoControlesVentana({ esElectron: true, overlayVisible: false }), 'propios')
  assert.equal(modoControlesVentana({ esElectron: false, overlayVisible: false }), 'ninguno')
  assert.equal(modoControlesVentana({ esElectron: true, overlayVisible: false, marcoNativo: true }), 'ninguno')
})

test('etiquetaMaximizar refleja el estado de la ventana', () => {
  assert.equal(etiquetaMaximizar(false), 'Maximizar')
  assert.equal(etiquetaMaximizar(true), 'Restaurar')
})

test('planBarraTitulo: primero cede la versión, luego las acciones pasan al menú «…»', () => {
  assert.deepEqual(planBarraTitulo(0), { mostrarVersion: true, accionesEnMenu: false })
  assert.deepEqual(planBarraTitulo(1200), { mostrarVersion: true, accionesEnMenu: false })
  assert.deepEqual(planBarraTitulo(560), { mostrarVersion: false, accionesEnMenu: false })
  assert.deepEqual(planBarraTitulo(400), { mostrarVersion: false, accionesEnMenu: true })
})

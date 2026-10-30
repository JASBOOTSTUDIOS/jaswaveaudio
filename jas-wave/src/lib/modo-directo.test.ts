/**
 * Modo Directo: qué atajos bloquea el candado.
 * npx tsx --test src/lib/modo-directo.test.ts
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { esAtajoBloqueadoEnDirecto } from './modo-directo'

describe('modo Directo · bloqueo de atajos', () => {
  it('bloquea borrar, deshacer/rehacer, cortar, pegar y duplicar', () => {
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'Delete' }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'Backspace' }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'z', ctrlKey: true }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'Z', ctrlKey: true, shiftKey: true }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'y', metaKey: true }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'x', ctrlKey: true }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'v', ctrlKey: true }), true)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'd', ctrlKey: true }), true)
  })

  it('deja pasar el transporte, letras sueltas y los campos de texto', () => {
    assert.equal(esAtajoBloqueadoEnDirecto({ key: ' ' }), false)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'r' }), false)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'z' }), false)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 's', ctrlKey: true }), false, 'guardar sigue permitido')
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'Delete', enCampoDeTexto: true }), false)
    assert.equal(esAtajoBloqueadoEnDirecto({ key: 'z', ctrlKey: true, enCampoDeTexto: true }), false)
  })
})

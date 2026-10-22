import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  _reiniciarRenderLock,
  activarRenderLock,
  desactivarRenderLock,
  estaRenderLock,
  suscribirRenderLock,
} from './render-lock'

describe('render-lock (U6)', () => {
  it('no bloquea al empezar', () => {
    _reiniciarRenderLock()
    assert.equal(estaRenderLock(), false)
  })

  it('bloquea y desbloquea notificando a los suscriptores', () => {
    _reiniciarRenderLock()
    const eventos: boolean[] = []
    const off = suscribirRenderLock((b) => eventos.push(b))
    activarRenderLock()
    assert.equal(estaRenderLock(), true)
    desactivarRenderLock()
    assert.equal(estaRenderLock(), false)
    off()
    assert.deepEqual(eventos, [true, false])
  })

  it('activar dos veces no duplica el aviso', () => {
    _reiniciarRenderLock()
    const eventos: boolean[] = []
    const off = suscribirRenderLock((b) => eventos.push(b))
    activarRenderLock()
    activarRenderLock()
    desactivarRenderLock()
    off()
    assert.deepEqual(eventos, [true, false])
  })
})

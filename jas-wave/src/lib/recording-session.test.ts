import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  _reiniciarSesionGrabacion,
  cerrarFinalizacionGrabacion,
  esperarFinalizacionGrabacion,
  hayGrabacionActiva,
  iniciarFinalizacionGrabacion,
} from './recording-session'

describe('recording-session (U6)', () => {
  it('no hay grabación en curso al empezar', async () => {
    _reiniciarSesionGrabacion()
    assert.equal(hayGrabacionActiva(), false)
    assert.equal(await esperarFinalizacionGrabacion(50), false)
  })

  it('espera a que la toma esté escrita', async () => {
    _reiniciarSesionGrabacion()
    iniciarFinalizacionGrabacion()
    assert.equal(hayGrabacionActiva(), true)

    let terminada = false
    const espera = esperarFinalizacionGrabacion(2000).then((r) => {
      terminada = r
      return r
    })
    // La toma todavía se está escribiendo: no debe resolverse.
    await new Promise((r) => setTimeout(r, 60))
    assert.equal(terminada, false)

    cerrarFinalizacionGrabacion()
    assert.equal(await espera, true)
    assert.equal(hayGrabacionActiva(), false)
  })

  it('no bloquea más del tiempo límite', async () => {
    _reiniciarSesionGrabacion()
    iniciarFinalizacionGrabacion()
    const t0 = Date.now()
    assert.equal(await esperarFinalizacionGrabacion(120), false)
    assert.ok(Date.now() - t0 < 1000)
    cerrarFinalizacionGrabacion()
  })
})

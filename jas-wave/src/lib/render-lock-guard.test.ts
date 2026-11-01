/**
 * npx tsx --test src/lib/render-lock-guard.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../shared/src'
import { _reiniciarRenderLock, activarRenderLock, desactivarRenderLock } from './render-lock'
import { MENSAJE_BLOQUEO_RENDER, instalarGuardiaRenderLock } from './render-lock-guard'

describe('render-lock-guard (U6)', () => {
  it('deja editar cuando no hay bounce', async () => {
    _reiniciarRenderLock()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    instalarGuardiaRenderLock(tienda)
    const r = await tienda.executor.execute('track.create', { nombre: 'Audio', tipo: 'audio' })
    assert.equal(r.success, true, r.error?.message)
  })

  it('bloquea la edición durante el bounce', async () => {
    _reiniciarRenderLock()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    instalarGuardiaRenderLock(tienda)
    activarRenderLock()
    try {
      const r = await tienda.executor.execute('track.create', { nombre: 'Audio', tipo: 'audio' })
      assert.equal(r.success, false)
      assert.equal(r.error?.code, 'RenderBusy')
      assert.equal(r.error?.message, MENSAJE_BLOQUEO_RENDER)
      const pistas = tienda.obtenerEstado().project?.tracks ?? []
      assert.equal(pistas.length, 0)
    } finally {
      desactivarRenderLock()
    }
  })

  it('una escritura de la IA espera a que termine el bounce y se ejecuta; la de una persona sigue bloqueada', async () => {
    _reiniciarRenderLock()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    instalarGuardiaRenderLock(tienda)
    activarRenderLock()
    const persona = await tienda.executor.execute('track.create', { nombre: 'A', tipo: 'audio' }, 'user')
    assert.equal(persona.error?.code, 'RenderBusy')
    const ia = tienda.executor.execute('track.create', { nombre: 'B', tipo: 'audio' }, 'ai')
    await new Promise((r) => setTimeout(r, 30))
    assert.equal((tienda.obtenerEstado().project?.tracks ?? []).length, 0, 'todavía esperando')
    desactivarRenderLock()
    const r = await ia
    assert.equal(r.success, true, r.error?.message)
    assert.equal((tienda.obtenerEstado().project?.tracks ?? []).length, 1)
  })

  it('deja pasar render.start y render.cancel durante el bounce', async () => {
    _reiniciarRenderLock()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    instalarGuardiaRenderLock(tienda)
    activarRenderLock()
    try {
      const r = await tienda.executor.execute('render.getStatus', { renderJobId: 'x' })
      assert.notEqual(r.error?.code, 'RenderBusy')
    } finally {
      desactivarRenderLock()
    }
  })

  it('vuelve a permitir la edición al terminar el bounce', async () => {
    _reiniciarRenderLock()
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    instalarGuardiaRenderLock(tienda)
    activarRenderLock()
    await tienda.executor.execute('track.create', { nombre: 'Bloqueada', tipo: 'audio' })
    desactivarRenderLock()
    const r = await tienda.executor.execute('track.create', { nombre: 'Permitida', tipo: 'audio' })
    assert.equal(r.success, true, r.error?.message)
  })
})

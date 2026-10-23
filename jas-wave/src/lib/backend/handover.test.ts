/**
 * npx tsx --test src/lib/backend/handover.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW } from '../../../../shared/src/state'
import { crearClienteApi } from './api'
import { aplicarHandover, datosParaHandover } from './handover'

/** Backend simulado: guarda el último handover y lo entrega una vez. */
function backendFalso() {
  let guardado: unknown = null
  const f = (async (url: string, init: RequestInit) => {
    if (url.endsWith('/handover') && init.method === 'POST') {
      guardado = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ token: 't'.repeat(43), url: `jaswave://abrir?token=${'t'.repeat(43)}`, caducaEn: '' }), { status: 201 })
    }
    if (url.endsWith('/handover/canjear')) {
      const r = guardado
      guardado = null
      return r ? new Response(JSON.stringify(r), { status: 200 }) : new Response(JSON.stringify({ error: { codigo: 'handover_invalido', mensaje: 'usado' } }), { status: 404 })
    }
    return new Response('{}', { status: 404 })
  }) as unknown as typeof fetch
  return crearClienteApi({ base: 'http://api', token: async () => 'jwt', fetch: f })
}

describe('H1 — handover en el renderer', () => {
  it('web → escritorio: restaura proyecto, posición, reproducción y sesión en < 3 s', async () => {
    const api = backendFalso()
    const web = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await web.executor.execute('track.create', { nombre: 'Voz web', tipo: 'midi' })
    await web.executor.execute('transport.seek', { segundos: 12.5 })
    await web.executor.execute('transport.toggle', {})
    await api.handover.crear(datosParaHandover(web.obtenerEstado()) as never, { access_token: 'a'.repeat(30), refresh_token: 'r'.repeat(12) })

    const escritorio = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    await escritorio.executor.execute('track.create', { nombre: 'Local previo', tipo: 'audio' })
    const sesiones: unknown[] = []
    const r = await aplicarHandover('t'.repeat(43), { api, tienda: escritorio, adoptarSesion: async (s) => void sesiones.push(s) })

    const st = escritorio.obtenerEstado()
    assert.deepEqual(st.project.tracks.map((t) => t.nombre), ['Voz web'])
    assert.equal(st.transport.posicion.segundos, 12.5)
    assert.equal(st.transport.reproduciendo, true)
    assert.equal(sesiones.length, 1)
    assert.equal(escritorio.executor.canUndo(), false) // historial del proyecto anterior descartado
    assert.ok(r.ms < 3000, `tardó ${r.ms} ms`)
  })

  it('un proyecto inválido no reemplaza nada y un token usado falla', async () => {
    const api = backendFalso()
    await api.handover.crear({ proyecto: { tracks: 'no' }, transporte: { segundos: 0, reproduciendo: false }, seleccion: {} })
    const t = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
    const antes = JSON.stringify(t.obtenerEstado().project)
    await assert.rejects(() => aplicarHandover('t'.repeat(43), { api, tienda: t, adoptarSesion: async () => undefined }), /no es válido/)
    assert.equal(JSON.stringify(t.obtenerEstado().project), antes)
    await assert.rejects(() => aplicarHandover('t'.repeat(43), { api, tienda: t, adoptarSesion: async () => undefined }), /usado/)
  })
})

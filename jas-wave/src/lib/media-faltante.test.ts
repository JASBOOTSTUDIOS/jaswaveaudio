import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  _reiniciarMediaFaltante,
  obtenerSolicitudMediaFaltante,
  responderSolicitudMediaFaltante,
  solicitarMediaFaltante,
  suscribirSolicitudMediaFaltante,
} from './media-faltante'

describe('media-faltante (solicitud)', () => {
  it('publica la solicitud y la resuelve', async () => {
    _reiniciarMediaFaltante()
    const promesa = solicitarMediaFaltante([{ id: 'c1', rutaRelativa: 'media/intro.wav' }], 'C:/p')
    assert.equal(obtenerSolicitudMediaFaltante()?.referencias.length, 1)
    assert.equal(obtenerSolicitudMediaFaltante()?.rutaProyecto, 'C:/p')
    responderSolicitudMediaFaltante('ignorar')
    assert.equal(await promesa, 'ignorar')
    assert.equal(obtenerSolicitudMediaFaltante(), null)
  })

  it('mantiene la identidad de la instantánea (useSyncExternalStore)', () => {
    _reiniciarMediaFaltante()
    solicitarMediaFaltante([{ id: 'c1', rutaRelativa: 'media/intro.wav' }])
    const a = obtenerSolicitudMediaFaltante()
    const b = obtenerSolicitudMediaFaltante()
    assert.equal(a, b)
    responderSolicitudMediaFaltante('ignorar')
  })

  it('avisa a los oyentes y no duplica la solicitud', async () => {
    _reiniciarMediaFaltante()
    let avisos = 0
    const baja = suscribirSolicitudMediaFaltante(() => {
      avisos++
    })
    const primera = solicitarMediaFaltante([{ id: 'c1', rutaRelativa: 'media/a.wav' }])
    const segunda = solicitarMediaFaltante([{ id: 'c2', rutaRelativa: 'media/b.wav' }])
    assert.equal(avisos, 1)
    assert.equal(await Promise.race([primera, Promise.resolve('otra')]), 'otra')
    assert.equal(segunda, primera)
    responderSolicitudMediaFaltante('ignorar')
    await primera
    baja()
    _reiniciarMediaFaltante()
  })
})

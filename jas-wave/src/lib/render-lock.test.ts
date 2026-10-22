import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  _reiniciarRenderLock,
  activarRenderLock,
  comandoBloqueadoDuranteRender,
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

  it('bloquea los comandos que editan la línea de tiempo, el audio y el transporte', () => {
    assert.equal(comandoBloqueadoDuranteRender('clip.create'), true)
    assert.equal(comandoBloqueadoDuranteRender('clip.move'), true)
    assert.equal(comandoBloqueadoDuranteRender('track.create'), true)
    assert.equal(comandoBloqueadoDuranteRender('transport.toggle'), true)
    assert.equal(comandoBloqueadoDuranteRender('midi.createNotes'), true)
    assert.equal(comandoBloqueadoDuranteRender('plugin.insert'), true)
    assert.equal(comandoBloqueadoDuranteRender('project.setBpm'), true)
  })

  it('permite render, análisis, selección y UI durante el bounce', () => {
    assert.equal(comandoBloqueadoDuranteRender('render.start'), false)
    assert.equal(comandoBloqueadoDuranteRender('render.cancel'), false)
    assert.equal(comandoBloqueadoDuranteRender('analysis.loudness'), false)
    assert.equal(comandoBloqueadoDuranteRender('selection.set'), false)
    assert.equal(comandoBloqueadoDuranteRender('ui.setTool'), false)
    assert.equal(comandoBloqueadoDuranteRender('project.save'), false)
  })
})

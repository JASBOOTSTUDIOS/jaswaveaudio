import assert from 'node:assert/strict'
import { describe, it, mock } from 'node:test'
import {
  beginProjectResourceLoad,
  getProjectReadySnapshot,
  markProjectBuffersNotNeeded,
  markProjectPluginsNotNeeded,
  registrarSondaHost,
  reportProjectDevice,
  reportProjectDeviceUnavailable,
  reportProjectHost,
} from './project-ready'

/** Deja el estado global sin «host listo» para forzar el caso de un proyecto nuevo con host desconocido. */
function olvidarHost() {
  reportProjectHost(false, 'prueba')
  reportProjectDevice(false, 'prueba')
}

describe('project-ready · el aviso «Listo con advertencias» no aparece en un uso normal', () => {
  it('al cambiar de proyecto sin host confirmado se comprueba activamente y el proyecto queda listo', async () => {
    olvidarHost()
    let llamadas = 0
    registrarSondaHost(async (gen) => {
      llamadas += 1
      reportProjectHost(true, 'Plugin Host disponible', gen)
      reportProjectDevice(true, 'Salida nativa armada', gen)
    })
    const gen = beginProjectResourceLoad('project:nuevo')
    markProjectPluginsNotNeeded(gen)
    markProjectBuffersNotNeeded(gen)
    await new Promise((r) => setTimeout(r, 10))
    registrarSondaHost(null)
    const s = getProjectReadySnapshot()
    assert.equal(llamadas, 1)
    assert.equal(s.phase, 'ready')
    assert.equal(s.errors.length, 0)
    assert.equal(s.label, 'Proyecto listo')
  })

  it('si el host ya estaba listo no se repite la comprobación', () => {
    reportProjectHost(true)
    reportProjectDevice(true)
    let llamadas = 0
    registrarSondaHost(async () => {
      llamadas += 1
    })
    const gen = beginProjectResourceLoad('project:otro')
    markProjectPluginsNotNeeded(gen)
    markProjectBuffersNotNeeded(gen)
    registrarSondaHost(null)
    assert.equal(llamadas, 0)
    assert.equal(getProjectReadySnapshot().phase, 'ready')
  })

  it('con el motor en manos de otra instancia no se bloquea esperando la salida, y vuelve a listo al recuperarlo', () => {
    reportProjectHost(true)
    reportProjectDevice(false, 'audio-engine-busy')
    const gen = beginProjectResourceLoad('project:ocupado')
    reportProjectHost(true, 'Plugin Host disponible', gen)
    markProjectPluginsNotNeeded(gen)
    markProjectBuffersNotNeeded(gen)
    assert.equal(getProjectReadySnapshot().blocking, true)
    reportProjectDeviceUnavailable('otra instancia')
    const s = getProjectReadySnapshot()
    assert.equal(s.phase, 'degraded')
    assert.equal(s.blocking, false)
    assert.equal(s.label, 'Listo sin audio (motor en uso)')
    reportProjectDeviceUnavailable(null)
    reportProjectDevice(true, 'Motor de audio recuperado', gen)
    assert.equal(getProjectReadySnapshot().phase, 'ready')
  })

  it('si el temporizador de seguridad salta, dice qué falta y se revierte solo cuando llega', () => {
    mock.timers.enable({ apis: ['setTimeout'] })
    try {
      olvidarHost()
      const gen = beginProjectResourceLoad('project:lento')
      markProjectPluginsNotNeeded(gen)
      markProjectBuffersNotNeeded(gen)
      mock.timers.tick(23_000)
      const degradado = getProjectReadySnapshot()
      assert.equal(degradado.phase, 'degraded')
      assert.equal(degradado.label, 'Listo con advertencias')
      assert.match(degradado.errors.join(' '), /Plugin Host/)
      assert.match(degradado.errors.join(' '), /salida de audio/)
      // los recursos llegan tarde: ya no hay nada que advertir
      reportProjectHost(true, 'Plugin Host disponible', gen)
      reportProjectDevice(true, 'Salida nativa armada', gen)
      const s = getProjectReadySnapshot()
      assert.equal(s.phase, 'ready')
      assert.equal(s.errors.length, 0)
      assert.equal(s.label, 'Proyecto listo')
    } finally {
      mock.timers.reset()
    }
  })
})

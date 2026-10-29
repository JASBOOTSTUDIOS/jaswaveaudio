import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { _reiniciarMonitor, estadoMonitor, fijarMonitor, fijarSilencioIA, gananciaMonitor } from './monitor-salida'

describe('monitorización (salida a altavoces)', () => {
  afterEach(() => _reiniciarMonitor())

  it('el volumen y el mute del usuario y el silencio de la IA son independientes', () => {
    fijarMonitor({ volumen: 0.5 })
    assert.equal(gananciaMonitor(), 0.5)
    fijarSilencioIA(true)
    assert.equal(gananciaMonitor(), 0, 'la IA trabaja sin sacar audio')
    assert.equal(estadoMonitor().volumen, 0.5, 'el volumen del usuario no se pierde')
    fijarSilencioIA(false)
    assert.equal(gananciaMonitor(), 0.5)
    fijarMonitor({ silenciado: true })
    assert.equal(gananciaMonitor(), 0)
    fijarMonitor({ silenciado: false, volumen: 2 })
    assert.equal(gananciaMonitor(), 1, 'acotado a 0–1')
  })
})

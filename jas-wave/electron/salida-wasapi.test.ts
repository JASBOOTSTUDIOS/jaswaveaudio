import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pickPreferredWasapi } from './salida-wasapi'

const REALTEK = { id: 'wasapi:{0.0.0.00000000}.{realtek}', backend: 'wasapi', name: 'Altavoces (Realtek(R) Audio)' }
const UMC = { id: 'wasapi:{0.0.0.00000000}.{umc}', backend: 'wasapi', name: 'OUT 1-2 (BEHRINGER UMC 204HD 192k)' }
const ASIO_UMC = { id: 'asio:UMC ASIO Driver', backend: 'asio', name: 'UMC ASIO Driver' }

describe('salida-wasapi', () => {
  it('respeta la salida WASAPI que eligió el usuario si sigue conectada', () => {
    const p = pickPreferredWasapi([UMC, REALTEK], { backend: 'wasapi', deviceId: REALTEK.id, sampleRate: 44100, bufferSize: 1024 })
    assert.equal(p.deviceId, REALTEK.id)
    assert.equal(p.sampleRate, 44100)
    assert.equal(p.bufferSize, 1024)
  })

  it('sin elección (o desconectada) prefiere la UMC', () => {
    assert.equal(pickPreferredWasapi([REALTEK, UMC], null).deviceId, UMC.id)
    const desconectada = { backend: 'wasapi', deviceId: 'wasapi:{0.0.0.00000000}.{otra}', sampleRate: 48000, bufferSize: 512 }
    assert.equal(pickPreferredWasapi([REALTEK, UMC], desconectada).deviceId, UMC.id)
  })

  it('unas preferencias ASIO no fijan la salida WASAPI', () => {
    const p = pickPreferredWasapi([REALTEK, UMC, ASIO_UMC], { backend: 'asio', deviceId: ASIO_UMC.id, sampleRate: 48000, bufferSize: 512 })
    assert.equal(p.deviceId, UMC.id)
    assert.equal(p.backend, 'wasapi')
  })

  it('sin UMC ni elección deja la predeterminada del sistema', () => {
    assert.equal(pickPreferredWasapi([REALTEK]).deviceId, '')
  })
})

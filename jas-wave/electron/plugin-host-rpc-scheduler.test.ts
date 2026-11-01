import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { claveSerieRpc, siguienteRpcEnviable, type EnVueloRpc } from './plugin-host-rpc-scheduler'

const q = (...cmds: Record<string, unknown>[]) => cmds.map((cmd) => ({ cmd }))
const paralelo = { paralelo: true, maxEnVuelo: 8 }

describe('plugin-host-rpc-scheduler', () => {
  it('sin rid (host antiguo) trabaja en serie', () => {
    const cola = q({ type: 'getTransportClock' })
    assert.equal(siguienteRpcEnviable(cola, [], { paralelo: false, maxEnVuelo: 8 }), 0)
    const vuelo: EnVueloRpc[] = [{ slotKey: 'slot:a', barrier: false }]
    assert.equal(siguienteRpcEnviable(cola, vuelo, { paralelo: false, maxEnVuelo: 8 }), -1)
  })

  it('una carga lenta de VST no frena subidas de clip ni el reloj', () => {
    const vuelo: EnVueloRpc[] = [{ slotKey: 'slot:piano', barrier: false }]
    const cola = q(
      { type: 'clip.loadChunk', clipId: 'c1' },
      { type: 'getTransportClock' },
    )
    assert.equal(siguienteRpcEnviable(cola, vuelo, paralelo), 0)
    assert.equal(siguienteRpcEnviable(cola.slice(1), vuelo, paralelo), 0)
  })

  it('comandos del mismo slot salen en orden; otros slots se adelantan', () => {
    const vuelo: EnVueloRpc[] = [{ slotKey: 'slot:piano', barrier: false }]
    const cola = q(
      { type: 'setPluginState', slotId: 'piano' },
      { type: 'load', slotId: 'bajo', path: 'C:/b.vst3' },
    )
    assert.equal(siguienteRpcEnviable(cola, vuelo, paralelo), 1)
  })

  it('no reordena dos comandos del mismo slot en cola', () => {
    const vuelo: EnVueloRpc[] = [{ slotKey: 'slot:piano', barrier: false }]
    const cola = q(
      { type: 'setPluginState', slotId: 'piano' },
      { type: 'listParameters', slotId: 'piano' },
      { type: 'ping' },
    )
    assert.equal(siguienteRpcEnviable(cola, vuelo, paralelo), 2)
  })

  it('las barreras esperan a que no haya nada en vuelo y bloquean al resto', () => {
    const cola = q({ type: 'setAudioDevice' }, { type: 'ping' })
    assert.equal(siguienteRpcEnviable(cola, [{ slotKey: 'slot:a', barrier: false }], paralelo), -1)
    assert.equal(siguienteRpcEnviable(cola, [], paralelo), 0)
    assert.equal(siguienteRpcEnviable(q({ type: 'ping' }), [{ slotKey: '', barrier: true }], paralelo), -1)
  })

  it('respeta el máximo en vuelo', () => {
    const vuelo: EnVueloRpc[] = Array.from({ length: 8 }, () => ({ slotKey: '', barrier: false }))
    assert.equal(siguienteRpcEnviable(q({ type: 'ping' }), vuelo, paralelo), -1)
  })

  it('clave de serie por slot y por clip', () => {
    assert.equal(claveSerieRpc({ type: 'load', slotId: 's1' }), 'slot:s1')
    assert.equal(claveSerieRpc({ type: 'clip.loadChunk', clipId: 'k' }), 'clip:k')
    assert.equal(claveSerieRpc({ type: 'getMixMeters' }), '')
  })
})

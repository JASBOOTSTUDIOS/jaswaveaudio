import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseDawCliLine, resolveTermCd, formatTermCwd } from './daw-cli-inapp'

describe('parseDawCliLine', () => {
  it('help / play / seek', () => {
    assert.equal(parseDawCliLine('help').kind, 'help')
    assert.equal(parseDawCliLine('ayuda').kind, 'help')
    assert.deepEqual(parseDawCliLine('play'), { kind: 'transport', action: 'play' })
    assert.deepEqual(parseDawCliLine('reproducir'), { kind: 'transport', action: 'play' })
    assert.deepEqual(parseDawCliLine('seek 12.5'), { kind: 'transport', action: 'seek', seekSec: 12.5 })
    assert.deepEqual(parseDawCliLine('buscar 3'), { kind: 'transport', action: 'seek', seekSec: 3 })
  })

  it('comandos básicos en español', () => {
    assert.equal(parseDawCliLine('limpiar').kind, 'clear')
    assert.equal(parseDawCliLine('clear').kind, 'clear')
    assert.equal(parseDawCliLine('cls').kind, 'clear')
    assert.equal(parseDawCliLine('donde').kind, 'pwd')
    assert.deepEqual(parseDawCliLine('cd ..'), { kind: 'cd', path: '..' })
    assert.deepEqual(parseDawCliLine('cd..'), { kind: 'cd', path: '..' })
    assert.deepEqual(parseDawCliLine('ir pistas'), { kind: 'cd', path: 'pistas' })
    assert.equal(parseDawCliLine('listar').kind, 'ls')
    assert.deepEqual(parseDawCliLine('eco hola'), { kind: 'echo', text: 'hola' })
    assert.equal(parseDawCliLine('detener').kind, 'transport')
    assert.deepEqual(parseDawCliLine('bpm 72'), { kind: 'action', type: 'project.setBpm', payload: { bpm: 72 } })
  })

  it('cd .. sube un nivel', () => {
    assert.deepEqual(resolveTermCd(['pistas', 'Batería'], '..'), ['pistas'])
    assert.deepEqual(resolveTermCd(['pistas'], '/'), [])
    assert.equal(formatTermCwd(['pistas']), '/pistas')
  })

  it('action con JSON y atajo de BPM', () => {
    const a = parseDawCliLine('action track.create {"nombre":"Batería","tipo":"midi"}')
    assert.equal(a.kind, 'action')
    if (a.kind === 'action') {
      assert.equal(a.type, 'track.create')
      assert.equal(a.payload.nombre, 'Batería')
    }
    const b = parseDawCliLine('project.setBpm 72')
    assert.equal(b.kind, 'action')
    if (a.kind === 'action' && b.kind === 'action') {
      assert.equal(b.payload.bpm, 72)
    }
  })
})

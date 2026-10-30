import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseAudioDeviceNotice, parseAudioDeviceNotices } from './audio-device-notice'

describe('audio-device-notice', () => {
  it('detecta la pérdida del dispositivo', () => {
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] device-lost'), 'lost')
  })

  it('detecta el reinicio pedido por el driver', () => {
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] audio-device-reset'), 'reset')
  })

  it('ignora el resto del log', () => {
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] ready (VST3 audio+editor)'), null)
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] mix pipe \\\\.\\pipe\\jaswave-mix-1'), null)
    assert.equal(parseAudioDeviceNotice(''), null)
  })

  it('extrae varios avisos de un bloque de stderr', () => {
    const avisos = parseAudioDeviceNotices(
      [
        '[jaswave-plugin-host] audio-device-reset',
        '[jaswave-plugin-host] ready',
        '[jaswave-plugin-host] device-lost: driver cerrado',
      ].join('\n'),
    )
    assert.deepEqual(avisos, ['reset', 'lost'])
  })

  it('no confunde device-lost con audio-device-reset', () => {
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] device-lost'), 'lost')
    assert.equal(parseAudioDeviceNotice('[jaswave-plugin-host] audio-device-reset'), 'reset')
  })
})

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PathGrants } from './path-grants'
import { checkHostCommand } from './plugin-host-guard'

function grants() {
  const g = new PathGrants({ platform: 'win32' })
  g.grant('C:\\Program Files\\Common Files\\VST3', 'read')
  g.grant('D:\\Proyectos\\cancion', 'readwrite')
  return g
}

describe('plugin-host-guard', () => {
  it('rechaza comandos desconocidos', () => {
    assert.equal(checkHostCommand({ type: 'exec' }, grants()).ok, false)
    assert.equal(checkHostCommand({}, grants()).ok, false)
  })

  it('load solo desde raíces VST concedidas y con extensión de plugin', () => {
    const g = grants()
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Program Files\\Common Files\\VST3\\Synth.vst3' }, g).ok, true)
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Users\\me\\Downloads\\evil.dll' }, g).ok, false)
    assert.equal(checkHostCommand({ type: 'load', path: 'C:\\Program Files\\Common Files\\VST3\\x.exe' }, g).ok, false)
  })

  it('render solo a carpetas con escritura', () => {
    const g = grants()
    assert.equal(checkHostCommand({ type: 'renderOfflineStart', outPath: 'D:\\Proyectos\\cancion\\mix.wav' }, g).ok, true)
    assert.equal(checkHostCommand({ type: 'renderOfflineStart', outPath: 'C:\\Windows\\mix.wav' }, g).ok, false)
  })

  it('permite comandos sin rutas', () => {
    assert.equal(checkHostCommand({ type: 'noteOn', note: 60 }, grants()).ok, true)
    assert.equal(checkHostCommand({ type: 'clip.load', clipId: 'a', pcmBase64: '' }, grants()).ok, true)
  })
})

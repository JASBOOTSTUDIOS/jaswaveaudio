import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { defaultVstRoots, PathGrants } from './path-grants'

describe('path-grants (win32)', () => {
  const g = () => {
    const grants = new PathGrants({ platform: 'win32' })
    grants.grant('C:\\Users\\me\\AppData\\Roaming\\JasWave', 'readwrite')
    grants.grant('C:\\Program Files\\Common Files\\VST3', 'read')
    return grants
  }

  it('permite rutas bajo raíces concedidas (sin distinguir mayúsculas)', () => {
    const grants = g()
    assert.equal(grants.isAllowed('C:\\Users\\me\\AppData\\Roaming\\JasWave\\library\\presets.json', 'write'), true)
    assert.equal(grants.isAllowed('c:/users/ME/appdata/roaming/jaswave/x.json', 'read'), true)
  })

  it('bloquea traversal y prefijos engañosos', () => {
    const grants = g()
    assert.equal(grants.isAllowed('C:\\Users\\me\\AppData\\Roaming\\JasWave\\..\\..\\secret.txt', 'read'), false)
    assert.equal(grants.isAllowed('C:\\Users\\me\\AppData\\Roaming\\JasWaveEvil\\x', 'read'), false)
    assert.equal(grants.isAllowed('C:\\Windows\\win.ini', 'read'), false)
  })

  it('respeta solo-lectura', () => {
    const grants = g()
    assert.equal(grants.isAllowed('C:\\Program Files\\Common Files\\VST3\\Foo.vst3', 'read'), true)
    assert.equal(grants.isAllowed('C:\\Program Files\\Common Files\\VST3\\Foo.vst3', 'write'), false)
  })

  it('rechaza UNC, device paths, relativas y NUL', () => {
    const grants = g()
    for (const p of ['\\\\server\\share\\x.wav', '\\\\?\\C:\\x', '//server/x', 'relative\\x', 'C:\\a\0b', 42]) {
      assert.equal(grants.isAllowed(p, 'read'), false, String(p))
      assert.equal(grants.isBinaryReadAllowed(p), false, String(p))
    }
  })

  it('lectura binaria de audio fuera de raíces, pero no de otros binarios', () => {
    const grants = g()
    assert.equal(grants.isBinaryReadAllowed('D:\\Samples\\kick.WAV'), true)
    assert.equal(grants.isBinaryReadAllowed('D:\\Samples\\evil.dll'), false)
    assert.equal(grants.isBinaryReadAllowed('C:\\Users\\me\\.ssh\\id_rsa'), false)
  })

  it('upgrade de read a readwrite, nunca downgrade', () => {
    const grants = new PathGrants({ platform: 'win32' })
    grants.grant('D:\\Proyectos', 'readwrite')
    grants.grant('D:\\Proyectos', 'read')
    assert.equal(grants.isAllowed('D:\\Proyectos\\a.jaswave', 'write'), true)
  })
})

describe('helpers', () => {
  it('defaultVstRoots usa variables de entorno', () => {
    const roots = defaultVstRoots({ CommonProgramFiles: 'C:\\Program Files\\Common Files', LOCALAPPDATA: 'C:\\L' })
    assert.ok(roots.includes('C:\\Program Files\\Common Files\\VST3'))
    assert.ok(roots.includes('C:\\L\\Programs\\Common\\VST3'))
  })
})

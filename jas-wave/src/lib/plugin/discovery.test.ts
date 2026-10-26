/**
 * npx tsx --test src/lib/plugin/discovery.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogPluginInsertable, descriptorFromDiscovered } from './discovery'
import { defaultVst3SearchPaths } from './search-paths'

describe('descriptorFromDiscovered', () => {
  it('marca VST2 como no insertable e incompatible', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/Program Files/VSTPlugins/W-Limit.dll',
      name: 'W-Limit',
      format: 'vst2',
      hostReady: false,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, false)
    assert.equal(catalogPluginInsertable(d), false)
    assert.equal(d.scanStatus, 'blacklisted')
    assert.match(d.scanError ?? '', /no soportado|vst3/i)
  })

  it('infiere vst2 por extensión y fuerza hostReady en false por estabilidad', () => {
    const d = descriptorFromDiscovered({
      path: 'D:/EQ/ValhallaRoom.dll',
      name: 'ValhallaRoom',
      hostReady: true,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, false)
    assert.equal(catalogPluginInsertable(d), false)
  })

  it('VST3 hostReady sí se puede insertar', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/Program Files/Common Files/VST3/Piano.vst3',
      name: 'Piano',
      format: 'vst3',
      hostReady: true,
      editorReady: true,
    })
    assert.equal(d.format, 'vst3')
    assert.equal(catalogPluginInsertable(d), true)
  })
})

describe('defaultVst3SearchPaths win32', () => {
  it('mantiene carpetas VST2 deshabilitadas por defecto', () => {
    const paths = defaultVst3SearchPaths('win32')
    assert.ok(paths.some((p) => p.format === 'vst2' && p.enabled === false))
    assert.ok(paths.some((p) => p.format === 'vst3' && p.enabled === true))
  })
})

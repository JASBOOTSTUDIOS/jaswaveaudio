/**
 * npx tsx --test src/lib/plugin/discovery.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { catalogPluginInsertable, descriptorFromDiscovered } from './discovery'
import { defaultVst3SearchPaths } from './search-paths'

describe('descriptorFromDiscovered', () => {
  it('marca VST2 sin hostReady como no insertable', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/Program Files/VSTPlugins/W-Limit.dll',
      name: 'W-Limit',
      format: 'vst2',
      hostReady: false,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, false)
    assert.equal(catalogPluginInsertable(d), false)
    assert.match(d.scanError ?? '', /x64|hosteable/i)
  })

  it('infiere vst2 por extensión y respeta hostReady del host', () => {
    const d = descriptorFromDiscovered({
      path: 'D:/EQ/ValhallaRoom.dll',
      name: 'ValhallaRoom',
      hostReady: true,
    })
    assert.equal(d.format, 'vst2')
    assert.equal(d.hostReady, true)
    assert.equal(catalogPluginInsertable(d), true)
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

  it('VST2 hostReady sí se puede insertar', () => {
    const d = descriptorFromDiscovered({
      path: 'C:/VSTPlugins/Synth.dll',
      name: 'Synth',
      format: 'vst2',
      hostReady: true,
      editorReady: true,
    })
    assert.equal(catalogPluginInsertable(d), true)
  })
})

describe('defaultVst3SearchPaths win32', () => {
  it('incluye carpetas VST2 típicas', () => {
    const paths = defaultVst3SearchPaths('win32')
    assert.ok(paths.some((p) => p.format === 'vst2' && /VSTPlugins/i.test(p.path)))
    assert.ok(paths.some((p) => p.format === 'vst3'))
  })
})

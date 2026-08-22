import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { GM_DRUM_MAP, inferPluginRole, localUsageGuide } from './plugin-knowledge'

describe('plugin-knowledge', () => {
  it('Addictive Drums es kit, no piano cromático', () => {
    assert.equal(inferPluginRole('Addictive Drums 2'), 'drums')
    const g = localUsageGuide('Addictive Drums 2')
    assert.equal(g.chromatic, false)
    assert.ok(g.map.some((m) => m.pitch === 36 && /kick|bombo/i.test(m.usage)))
  })
  it('Ample Guitar usa rango de cuerdas', () => {
    const g = localUsageGuide('Ample Guitar LP')
    assert.equal(g.role, 'guitar')
    assert.ok(g.map.some((m) => m.pitch === 40))
  })
  it('GM incluye caja en D1', () => {
    assert.ok(GM_DRUM_MAP.some((m) => m.pitch === 38))
  })
})

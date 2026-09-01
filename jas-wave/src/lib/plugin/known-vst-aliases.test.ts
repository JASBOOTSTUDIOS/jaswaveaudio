import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalPluginName,
  expandPluginNameQueries,
  preferredKnownVstPath,
} from './known-vst-aliases'

describe('known-vst-aliases', () => {
  it('maps Descent → DecentSampler', () => {
    assert.equal(canonicalPluginName('Descent'), 'DecentSampler')
    assert.equal(canonicalPluginName('descent'), 'DecentSampler')
    const q = expandPluginNameQueries('Descent')
    assert.ok(q.includes('DecentSampler'))
    assert.ok(q.includes('decentsampler'))
  })

  it('prefers a DecentSampler path under VST3', () => {
    const path = preferredKnownVstPath('Descent')
    assert.ok(path.toLowerCase().includes('decentsampler.vst3'))
  })
})

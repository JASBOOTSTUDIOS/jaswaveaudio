/**
 * npx tsx --test src/lib/plugin/plugin-info-adapter.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  extractHostPluginPath,
  extractVst3Path,
  guessIsInstrument,
  isLikelyAudioFx,
} from './plugin-info-adapter'

describe('guessIsInstrument', () => {
  it('BFDPlayer es instrumento', () => {
    assert.equal(guessIsInstrument('BFDPlayer'), true)
    assert.equal(
      guessIsInstrument('BFDPlayer', 'C:/Program Files/Common Files/VST3/BFDPlayer.vst3'),
      true,
    )
  })

  it('Analog Lab V sigue siendo instrumento', () => {
    assert.equal(guessIsInstrument('Analog Lab V'), true)
  })

  it('EQ / reverb típicos no son instrumento', () => {
    assert.equal(guessIsInstrument('Pro-Q 3'), false)
    assert.equal(isLikelyAudioFx('Pro-Q 3'), true)
    assert.equal(guessIsInstrument('ValhallaRoom'), false)
  })
})

describe('extractHostPluginPath', () => {
  it('acepta .vst3 y .dll', () => {
    assert.equal(extractHostPluginPath('C:/VST3/Piano.vst3 · Vendor'), 'C:/VST3/Piano.vst3')
    assert.equal(
      extractHostPluginPath('C:/VSTPlugins/ValhallaSupermassive_x64.dll'),
      'C:/VSTPlugins/ValhallaSupermassive_x64.dll',
    )
  })

  it('extractVst3Path es alias', () => {
    const p = 'D:/EQ/Room.dll'
    assert.equal(extractVst3Path(p), extractHostPluginPath(p))
  })
})

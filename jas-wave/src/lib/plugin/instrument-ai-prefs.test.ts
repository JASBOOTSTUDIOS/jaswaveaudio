/**
 * Tests: instrument AI prefs (defaults por rol + disable).
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clearRoleDefaultForPlugin,
  filterCatalogForAi,
  getRoleDefault,
  isPluginAiEnabled,
  resolveRoleDefaultFromCatalog,
  setPluginAiEnabled,
  setRoleDefault,
  getInstrumentAiPrefs,
} from './instrument-ai-prefs'
import type { PluginDescriptor } from './types'
import { pickVstForRole } from '../plugin-knowledge'

function desc(partial: Partial<PluginDescriptor> & { pluginId: string; name: string }): PluginDescriptor {
  return {
    format: 'vst3',
    vendor: 'Test',
    category: '',
    version: '1',
    path: `/plugins/${partial.name}.vst3`,
    isInstrument: true,
    isEffect: false,
    supportsMidiInput: true,
    supportsMidiOutput: false,
    supportsAudioInput: false,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: true,
    parameterCount: 0,
    hostReady: true,
    scanStatus: 'ok',
    isolation: 'out-of-process',
    ...partial,
  }
}

describe('instrument-ai-prefs', () => {
  it('desactiva plugins para la IA sin borrarlos del catálogo', () => {
    const a = desc({ pluginId: 'p-a', name: 'Kit A' })
    const b = desc({ pluginId: 'p-b', name: 'Kit B' })
    setPluginAiEnabled(a.pluginId, true)
    setPluginAiEnabled(b.pluginId, true)
    setPluginAiEnabled(a.pluginId, false)
    assert.equal(isPluginAiEnabled(a.pluginId), false)
    assert.equal(isPluginAiEnabled(b.pluginId), true)
    const filtered = filterCatalogForAi([a, b])
    assert.deepEqual(
      filtered.map((d) => d.pluginId),
      ['p-b'],
    )
    setPluginAiEnabled(a.pluginId, true)
  })

  it('guarda default por rol y lo resuelve desde el catálogo', () => {
    const bfd = desc({ pluginId: 'bfd', name: 'BFD Player' })
    const other = desc({ pluginId: 'toy', name: 'Toy Drums' })
    setRoleDefault('drums', { pluginId: bfd.pluginId, pluginNombre: bfd.name })
    assert.equal(getRoleDefault('drums')?.pluginId, 'bfd')
    const hit = resolveRoleDefaultFromCatalog([other, bfd], 'drums')
    assert.equal(hit?.pluginId, 'bfd')
    clearRoleDefaultForPlugin('bfd')
    assert.equal(getRoleDefault('drums'), null)
  })

  it('pickVstForRole prioriza el default del usuario', () => {
    const preferred = desc({ pluginId: 'my-piano', name: 'My Custom Piano' })
    const other = desc({ pluginId: 'keyscape', name: 'Keyscape' })
    setPluginAiEnabled(preferred.pluginId, true)
    setPluginAiEnabled(other.pluginId, true)
    setRoleDefault('piano', { pluginId: preferred.pluginId, pluginNombre: preferred.name })
    const pick = pickVstForRole([other, preferred], 'piano')
    assert.equal(pick?.pluginId, 'my-piano')
    setRoleDefault('piano', null)
  })

  it('pickVstForRole ignora defaults desactivados para IA', () => {
    const preferred = desc({ pluginId: 'off-kit', name: 'BFD Player Offline' })
    const fallback = desc({ pluginId: 'addictive', name: 'Addictive Drums' })
    setRoleDefault('drums', { pluginId: preferred.pluginId, pluginNombre: preferred.name })
    setPluginAiEnabled(preferred.pluginId, false)
    setPluginAiEnabled(fallback.pluginId, true)
    const pick = pickVstForRole([preferred, fallback], 'drums')
    assert.equal(pick?.pluginId, 'addictive')
    setPluginAiEnabled(preferred.pluginId, true)
    setRoleDefault('drums', null)
  })

  it('un plugin con distinta config puede ser default de varios roles', () => {
    setRoleDefault('piano', {
      pluginId: 'ds',
      pluginNombre: 'DecentSampler',
      presetId: 'preset-piano',
      presetNombre: 'Piano acústico',
    })
    setRoleDefault('pad', {
      pluginId: 'ds',
      pluginNombre: 'DecentSampler',
      presetId: 'preset-pad',
      presetNombre: 'Pad ambient',
    })
    const prefs = getInstrumentAiPrefs()
    assert.equal(prefs.roleDefaults.piano?.presetId, 'preset-piano')
    assert.equal(prefs.roleDefaults.pad?.presetId, 'preset-pad')
    setRoleDefault('piano', null)
    setRoleDefault('pad', null)
  })

  it('misma config exacta no es default de dos roles', () => {
    setRoleDefault('piano', { pluginId: 'x', pluginNombre: 'X', presetId: 'same' })
    setRoleDefault('keys', { pluginId: 'x', pluginNombre: 'X', presetId: 'same' })
    const prefs = getInstrumentAiPrefs()
    assert.equal(prefs.roleDefaults.piano, undefined)
    assert.equal(prefs.roleDefaults.keys?.presetId, 'same')
    setRoleDefault('keys', null)
  })
})

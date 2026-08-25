/**
 * FakePlugin — efecto de prueba in-process (ADR-0011).
 * Soft Pad reemplazado por JasWaveRoles.vst3 nativo.
 */

import { isolationForFormat } from './isolation-policy'
import type { PluginDescriptor, PluginParameterMeta } from './types'

export const FAKE_PLUGIN_ID = 'jaswave.fake.gain'

export function createFakePluginDescriptor(): PluginDescriptor {
  return {
    pluginId: FAKE_PLUGIN_ID,
    format: 'builtin',
    vendor: 'JasWave',
    name: 'Fake Gain',
    version: '0.1.0',
    category: 'effect',
    isInstrument: false,
    isEffect: true,
    supportsMidiInput: false,
    supportsMidiOutput: false,
    supportsAudioInput: true,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: false,
    parameterCount: 2,
    scanStatus: 'ok',
    hostReady: true,
    isolation: isolationForFormat('builtin'),
  }
}

export function createFakePluginParameters(): PluginParameterMeta[] {
  return [
    {
      parameterId: 'gain',
      name: 'Gain',
      normalizedValue: 0.7,
      plainValue: 0,
      min: -24,
      max: 24,
      default: 0,
      unit: 'dB',
      automatable: true,
      readable: true,
      writable: true,
    },
    {
      parameterId: 'bypass',
      name: 'Bypass',
      normalizedValue: 0,
      plainValue: 0,
      min: 0,
      max: 1,
      default: 0,
      automatable: true,
      readable: true,
      writable: true,
    },
  ]
}

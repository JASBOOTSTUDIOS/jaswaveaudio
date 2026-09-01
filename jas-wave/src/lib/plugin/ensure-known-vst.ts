/**
 * Registra en el catálogo VSTs conocidos por alias (Descent → DecentSampler) si faltan.
 */

import { lookupKnownVst, canonicalPluginName } from './known-vst-aliases'
import { pluginRegistry } from './registry'
import type { PluginDescriptor } from './types'

function descriptorFromKnown(name: string, path: string): PluginDescriptor {
  return {
    pluginId: `path:${path}`,
    name,
    path,
    format: path.toLowerCase().endsWith('.dll') ? 'vst2' : 'vst3',
    category: 'instrument',
    isInstrument: true,
    isEffect: false,
    vendor: '',
    version: '',
    hostReady: true,
    scanStatus: 'ok',
    supportsMidiInput: true,
    supportsMidiOutput: false,
    supportsAudioInput: false,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: true,
    parameterCount: 0,
    isolation: 'out-of-process',
  }
}

/** Resuelve alias/ruta conocida y registra el descriptor si no estaba en el catálogo. */
export function ensureKnownVstInRegistry(query: string): PluginDescriptor | undefined {
  const q = query.trim()
  if (!q) return undefined
  const hit = lookupKnownVst(q)
  if (hit) {
    const existing =
      pluginRegistry.list().find((d) => hit.paths.some((p) => d.path === p)) ??
      pluginRegistry.findByName(hit.name)[0]
    if (existing) return existing
    const path = hit.paths[0]
    if (!path) return undefined
    const d = descriptorFromKnown(hit.name, path)
    pluginRegistry.register(d)
    return d
  }
  const canon = canonicalPluginName(q)
  if (canon !== q) return pluginRegistry.findByName(canon)[0]
  return undefined
}

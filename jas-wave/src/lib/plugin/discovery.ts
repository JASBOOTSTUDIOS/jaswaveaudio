/**
 * Discovery de candidatos VST3 (filesystem / host process).
 * Discovery ≠ Load (ADR-0011).
 */

import { persistPluginCatalog } from './catalog-store'
import { isolationForFormat } from './isolation-policy'
import { guessIsInstrument } from './plugin-info-adapter'
import { pluginRegistry } from './registry'
import { expandPluginSearchPath, pluginSearchPaths } from './search-paths'
import type { PluginDescriptor, PluginHostDiscoveredPlugin } from './types'

function hashId(pathStr: string): string {
  let h = 2166136261
  for (let i = 0; i < pathStr.length; i++) {
    h ^= pathStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `vst3.${(h >>> 0).toString(16)}`
}

export function descriptorFromDiscovered(
  item: PluginHostDiscoveredPlugin,
  vendor = '—',
): PluginDescriptor {
  const pluginPath = item.path
  const name = item.name || pluginPath.replace(/^.*[/\\]/, '').replace(/\.vst3$/i, '')
  const isInstrument = guessIsInstrument(name, pluginPath)
  return {
    pluginId: hashId(pluginPath),
    format: 'vst3',
    vendor,
    name,
    version: 'unknown',
    path: pluginPath,
    category: isInstrument ? 'instrumento' : 'efecto',
    isInstrument,
    isEffect: !isInstrument,
    supportsMidiInput: isInstrument,
    supportsMidiOutput: false,
    supportsAudioInput: !isInstrument,
    supportsAudioOutput: true,
    supportsSidechain: false,
    supportsEditor: item.editorReady !== false,
    parameterCount: 0,
    scanStatus: 'ok',
    // hostReady = process/audio. La UI nativa usa editorReady vía jaswave-vst3-editor.
    hostReady: item.hostReady === true,
    isolation: isolationForFormat('vst3'),
    scanError:
      item.hostReady === true
        ? undefined
        : 'En catálogo (disco). Audio VST3 pendiente; UI nativa si editorhost está compilado.',
  }
}

export type DiscoverResult = {
  discovered: PluginDescriptor[]
  registered: number
  backend?: string
  error?: string
}

/**
 * Usa el host process (via callback RPC) para listar .vst3 en rutas habilitadas.
 */
export async function discoverVst3Plugins(
  rpc: (cmd: { type: 'discover'; path: string }) => Promise<{
    ok: boolean
    plugins?: PluginHostDiscoveredPlugin[]
    message?: string
    processId?: string
  }>,
  paths?: string[],
): Promise<DiscoverResult> {
  const roots = paths?.length
    ? paths.map(expandPluginSearchPath)
    : pluginSearchPaths.enabledExpandedPaths()

  const discovered: PluginDescriptor[] = []
  const seen = new Set<string>()
  let lastError: string | undefined

  for (const root of roots) {
    if (!root?.trim()) continue
    const reply = await rpc({ type: 'discover', path: root })
    if (!reply.ok) {
      lastError = reply.message
      continue
    }
    for (const item of reply.plugins ?? []) {
      if (!item.path || seen.has(item.path)) continue
      seen.add(item.path)
      const desc = descriptorFromDiscovered(item)
      discovered.push(desc)
      pluginRegistry.register(desc)
    }
  }

  persistPluginCatalog(discovered)

  return {
    discovered,
    registered: discovered.length,
    error: discovered.length === 0 ? lastError : undefined,
  }
}

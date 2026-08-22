/**
 * Host de plugins (ADR-0011) — fachada sobre PluginManager híbrido.
 */

import { pluginManager } from './plugin-manager'
import { pluginSearchPaths } from './search-paths'
import type { PluginDescriptor, PluginInstanceRef, PluginLifecycleState } from './types'

export type { PluginDescriptor, PluginFormat, PluginIsolationMode, PluginInstanceRef } from './types'
export { pluginRegistry } from './registry'
export { PluginHostError } from './types'
export { pluginManager } from './plugin-manager'
export { pluginCompatibilityDb } from './compatibility-db'
export { pluginSearchPaths, defaultVst3SearchPaths, expandPluginSearchPath } from './search-paths'
export {
  hydratePluginSearchPaths,
  persistPluginSearchPaths,
  addCustomScanFolder,
  removeCustomScanFolder,
  setScanFolderEnabled,
  listScanFolders,
} from './search-paths-store'
export { isolationForFormat } from './isolation-policy'
export { discoverVst3Plugins, descriptorFromDiscovered } from './discovery'

/** Rutas típicas Windows (metadatos; no se cargan DLL). */
export const DEFAULT_VST3_SCAN_PATHS_WIN = pluginSearchPaths
  .list()
  .filter((p) => p.format === 'vst3')
  .map((p) => p.path)

export async function listAvailablePlugins(): Promise<PluginDescriptor[]> {
  return pluginManager.listAvailable()
}

export async function scanVst3Paths(paths: string[]): Promise<PluginDescriptor[]> {
  return pluginManager.scanVst3CandidatePaths(paths)
}

export async function discoverInstalledVst3(paths?: string[]) {
  return pluginManager.discoverVst3(paths)
}

export function isPluginHostNativeReady(): boolean {
  return pluginManager.isNativeVst3Ready()
}

export async function instantiatePlugin(
  pluginId: string,
  trackId: string,
  position = 0,
): Promise<PluginInstanceRef> {
  return pluginManager.instantiate(pluginId, trackId, position)
}

export function getPluginInstance(instanceId: string): PluginInstanceRef | undefined {
  return pluginManager.get(instanceId)
}

export function setInstanceLifecycle(instanceId: string, lifecycle: PluginLifecycleState): void {
  pluginManager.setLifecycle(instanceId, lifecycle)
}

export async function unloadPlugin(instanceId: string): Promise<void> {
  await pluginManager.unload(instanceId)
}

export function toLegacyDescriptor(d: PluginDescriptor): {
  id: string
  name: string
  vendor: string
  format: PluginDescriptor['format']
  path?: string
  category: 'instrument' | 'effect' | 'analyzer'
  ready: boolean
  note?: string
} {
  return {
    id: d.pluginId,
    name: d.name,
    vendor: d.vendor,
    format: d.format,
    path: d.path,
    category: d.isInstrument ? 'instrument' : 'effect',
    ready: d.hostReady && d.scanStatus === 'ok',
    note: d.scanError,
  }
}

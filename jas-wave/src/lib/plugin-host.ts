/**
 * Host de plugins (ADR-0011) — reexport del módulo plugin/.
 */

export {
  DEFAULT_VST3_SCAN_PATHS_WIN,
  getPluginInstance,
  instantiatePlugin,
  isPluginHostNativeReady,
  listAvailablePlugins,
  discoverInstalledVst3,
  pluginManager,
  pluginRegistry,
  pluginCompatibilityDb,
  pluginSearchPaths,
  PluginHostError,
  scanVst3Paths,
  setInstanceLifecycle,
  toLegacyDescriptor,
  unloadPlugin,
  isolationForFormat,
  type PluginDescriptor,
  type PluginFormat,
  type PluginIsolationMode,
  type PluginInstanceRef,
} from './plugin/host'

export { discoverVst3Plugins, descriptorFromDiscovered } from './plugin/discovery'
export {
  createElectronPluginHostBridge,
  refreshPluginHostAvailability,
} from './plugin/electron-bridge-client'

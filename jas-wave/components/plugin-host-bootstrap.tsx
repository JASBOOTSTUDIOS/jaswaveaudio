/**
 * Arranca el bridge Electron → Plugin Host Process y catálogo persistido.
 */

import { useEffect } from 'react'
import { hydratePluginCatalog } from '@/src/lib/plugin/catalog-store'
import {
  createElectronPluginHostBridge,
  pluginManager,
  refreshPluginHostAvailability,
} from '@/src/lib/plugin-host'

export function PluginHostBootstrap() {
  useEffect(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    if (!window.electron?.pluginHostEnsure) return
    pluginManager.attachHostBridge(createElectronPluginHostBridge())
    void refreshPluginHostAvailability()
  }, [])
  return null
}

/**
 * Arranca el bridge Electron → Plugin Host Process y catálogo persistido.
 */

import { useEffect } from 'react'
import { audioEngine } from '@/lib/audio-engine'
import { isUndockWindow } from '@/lib/undock-window'
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
    // Satélite: no arrancar device ni tap PCM (un solo cliente ASIO / un solo pipe).
    if (isUndockWindow()) return
    void refreshPluginHostAvailability().then(() => {
      void audioEngine.armNativeMixOutput()
    })
  }, [])
  return null
}


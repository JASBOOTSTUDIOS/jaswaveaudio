/**
 * Arranca el bridge Electron → Plugin Host Process y catálogo persistido.
 */

import { useEffect } from 'react'
import { audioEngine } from '@/lib/audio-engine'
import { isUndockWindow } from '@/lib/undock-window'
import {
  hydratePluginCatalog,
  promoteCachedVst3WhenHostReady,
} from '@/src/lib/plugin/catalog-store'
import {
  createElectronPluginHostBridge,
  pluginManager,
  refreshPluginHostAvailability,
} from '@/src/lib/plugin-host'
import {
  getProjectReadyGeneration,
  reportProjectDevice,
  reportProjectHost,
} from '@/src/lib/project-ready'
import { ensureJasWaveRolesRegistered, setLocalAppDataHint } from '@/src/lib/plugin/jaswave-roles'
import { ensureJasWavePianoRegistered } from '@/src/lib/plugin/jaswave-piano'

export function PluginHostBootstrap() {
  useEffect(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    void window.electron?.localAppData?.().then((p: string) => {
      if (p) setLocalAppDataHint(p)
      ensureJasWaveRolesRegistered()
      ensureJasWavePianoRegistered()
    })
    ensureJasWaveRolesRegistered()
    ensureJasWavePianoRegistered()
    const gen = getProjectReadyGeneration()
    if (!window.electron?.pluginHostEnsure) {
      reportProjectHost(false, 'no-electron', gen)
      return
    }
    pluginManager.attachHostBridge(createElectronPluginHostBridge())
    // Satélite: no arrancar device ni tap PCM (un solo cliente ASIO / un solo pipe).
    if (isUndockWindow()) {
      reportProjectHost(true, 'undock', gen)
      reportProjectDevice(true, 'undock', gen)
      return
    }
    void refreshPluginHostAvailability()
      .then((ok) => {
        reportProjectHost(ok, ok ? 'Plugin Host disponible' : 'Plugin Host no disponible', gen)
        if (ok) promoteCachedVst3WhenHostReady()
        return audioEngine.armNativeMixOutput()
      })
      .then((armed) => {
        reportProjectDevice(
          Boolean(armed),
          armed
            ? 'Salida nativa armada'
            : audioEngine.getTimingDiagnostics().lastArmError || 'arm falló',
          gen,
        )
      })
      .catch((err) => {
        reportProjectHost(false, err instanceof Error ? err.message : String(err), gen)
        reportProjectDevice(false, 'arm error', gen)
      })
    // Host muerto (EPIPE / crash VST): rearmar mix + metrónomo cuando vuelva.
    const offExit = window.electron?.onPluginHostExited?.(() => {
      void (async () => {
        const g = getProjectReadyGeneration()
        reportProjectHost(false, 'host exited', g)
        reportProjectDevice(false, 'rearm pending', g)
        await window.electron?.pluginHostEnsure?.()
        reportProjectHost(true, 'host restarted', g)
        const armed = await audioEngine.armNativeMixOutput()
        reportProjectDevice(Boolean(armed), armed ? 'rearm ok' : 'rearm fail', g)
      })()
    })
    const offRestart = window.electron?.onPluginHostRestarted?.(() => {
      void (async () => {
        const g = getProjectReadyGeneration()
        const armed = await audioEngine.armNativeMixOutput()
        reportProjectHost(true, 'host restarted', g)
        reportProjectDevice(Boolean(armed), armed ? 'rearm ok' : 'rearm fail', g)
      })()
    })
    return () => {
      offExit?.()
      offRestart?.()
    }
  }, [])
  return null
}

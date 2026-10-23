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
import {
  defaultJasWaveRolesPath,
  ensureJasWaveRolesRegistered,
  setLocalAppDataHint,
} from '@/src/lib/plugin/jaswave-roles'
import { defaultJasWavePianoPath, ensureJasWavePianoRegistered } from '@/src/lib/plugin/jaswave-piano'
import {
  fetchKnownPaths,
  JASWAVE_PIANO_BUNDLE,
  JASWAVE_ROLES_BUNDLE,
  pickJasWavePluginPath,
} from '@/src/lib/plugin/bundled-plugins'
import { setBundledVst3SearchDir } from '@/src/lib/plugin/search-paths'
import { cargarPluginsInstalados } from '@/src/lib/plugins/registro-plugins'

export function PluginHostBootstrap() {
  useEffect(() => {
    hydratePluginCatalog()
    // Plugins JasWave por manifiesto (P1): valida, descarta alterados y registra sus herramientas IA.
    void cargarPluginsInstalados().catch((e) => console.warn('[plugins] no se pudieron cargar los paquetes', e))
    pluginManager.ensureBuiltins()
    void window.electron?.localAppData?.().then(async (p: string) => {
      if (p) setLocalAppDataHint(p)
      // Instalación de usuario primero; si falta, los bundles de resources/vst3/JasWave (app empaquetada).
      const known = await fetchKnownPaths()
      const exists = (path: string) => window.electron?.fileExists?.(path) ?? Promise.resolve(false)
      const roles = await pickJasWavePluginPath(JASWAVE_ROLES_BUNDLE, defaultJasWaveRolesPath(), known?.bundledVst3Dir, exists)
      const piano = await pickJasWavePluginPath(JASWAVE_PIANO_BUNDLE, defaultJasWavePianoPath(), known?.bundledVst3Dir, exists)
      ensureJasWaveRolesRegistered(roles.source === 'bundled' ? roles.path : undefined)
      ensureJasWavePianoRegistered(piano.source === 'bundled' ? piano.path : undefined)
      // Escanear la carpeta incluida solo si ninguno está instalado por el usuario (evita duplicados).
      if (roles.source !== 'user' && piano.source !== 'user' && known?.bundledVst3Dir) {
        setBundledVst3SearchDir(known.bundledVst3Dir)
      }
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

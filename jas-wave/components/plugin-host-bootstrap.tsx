/**
 * Arranca el bridge Electron → Plugin Host Process y catálogo persistido.
 */

import { useEffect } from 'react'
import { ARM_ERROR_MOTOR_OCUPADO, audioEngine } from '@/lib/audio-engine'
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
  reportProjectDeviceUnavailable,
  reportProjectHost,
  registrarSondaHost,
} from '@/src/lib/project-ready'

const MOTOR_OCUPADO_DETALLE = 'Otra ventana de JasWave usa el motor de audio: esta sigue sin sonido.'
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
import { cargarPluginsInstalados, desactivarPlugin, pluginPorRuta } from '@/src/lib/plugins/registro-plugins'
import { getSharedStore } from '@/src/context/daw-context'
import { sincronizarParametrosConHost } from '@/src/lib/plugin/plugin-reset'

export function PluginHostBootstrap() {
  useEffect(() => {
    hydratePluginCatalog()
    // Plugins JasWave por manifiesto (P1): valida, descarta alterados y registra sus herramientas IA.
    void cargarPluginsInstalados().catch((e) => console.warn('[plugins] no se pudieron cargar los paquetes', e))
    // Watchdog: un plugin apartado deja de ofrecer herramientas al agente y se avisa al usuario.
    const dejarDeOirCuarentena = window.electron?.onPluginCuarentena?.((aviso) => {
      const plugin = pluginPorRuta(aviso.ruta)
      if (plugin) desactivarPlugin(plugin.manifiesto.id)
      getSharedStore().busEventos.emit('plugin.cuarentena', { mensaje: aviso.mensaje, motivo: aviso.motivo })
    })
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
      return () => dejarDeOirCuarentena?.()
    }
    // Cada cambio de parámetro del dominio (UI, IA, editor web, deshacer/rehacer) llega al VST en vivo.
    const dejarDeSincronizar = sincronizarParametrosConHost(getSharedStore())
    // Comprobación del host y la salida de audio: al arrancar y en cada proyecto nuevo/abierto en que no se sepa
    // con certeza que siguen listos (antes solo se informaba una vez al montar y el estado se quedaba colgado).
    const comprobarHostYSalida = async (g: number) => {
      try {
        const ok = await refreshPluginHostAvailability()
        reportProjectHost(ok, ok ? 'Plugin Host disponible' : 'Plugin Host no disponible', g)
        if (ok) promoteCachedVst3WhenHostReady()
        const armed = await audioEngine.armNativeMixOutput()
        const motivo = audioEngine.getTimingDiagnostics().lastArmError
        // Motor en manos de otra instancia: no se espera la salida (el aviso y el reintento los lleva el puente).
        if (!armed && motivo === ARM_ERROR_MOTOR_OCUPADO) reportProjectDeviceUnavailable(MOTOR_OCUPADO_DETALLE)
        reportProjectDevice(Boolean(armed), armed ? 'Salida nativa armada' : motivo || 'arm falló', g)
        // El catálogo solo se actualizaba al pulsar «Escanear»: los instrumentos recién desplegados no entraban y el
        // host cargaba copias antiguas. Se escanea al arrancar, cuando el host ya se estabilizó (arrancar ASIO lo
        // reinicia «en proceso limpio» y los comandos fallan mientras tanto), y con el catálogo al día cada plugin
        // propio del proyecto pasa a su mejor copia (la ruta guardada puede ser de una compilación obsoleta).
        if (ok) void escanearCatalogoYReajustar()
      } catch (err) {
        reportProjectHost(false, err instanceof Error ? err.message : String(err), g)
        reportProjectDevice(false, 'arm error', g)
      }
    }
    const escanearCatalogoYReajustar = async () => {
      for (let intento = 0; intento < 4; intento++) {
        const r = await pluginManager.discoverVst3().catch((e: unknown) => ({ registered: 0, error: String(e) }))
        if (r.registered > 0) {
          const st = getSharedStore().obtenerEstado()
          const { ensureProjectVstInstruments } = await import('@/src/lib/plugin/track-vst-runtime')
          await ensureProjectVstInstruments(
            (st.project?.tracks ?? []).map((t) => ({ id: t.id, plugins: t.plugins })),
            st.project?.master?.plugins,
          ).catch(() => undefined)
          return
        }
        await new Promise((res) => setTimeout(res, 3000 * (intento + 1)))
      }
      console.warn('[plugins] no se pudo escanear el catálogo al arrancar')
      window.electron?.logError?.('plugins', 'no se pudo escanear el catálogo al arrancar (4 intentos)')
    }
    registrarSondaHost(comprobarHostYSalida)
    void comprobarHostYSalida(gen)
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
    // Otra instancia toma o suelta el motor de audio: sin esperar la salida mientras está ocupado,
    // y rearmada en cuanto el puente lo recupera.
    const offBusy = window.electron?.onAudioEngineBusy?.((info) => {
      if (info?.activo) {
        reportProjectDeviceUnavailable(MOTOR_OCUPADO_DETALLE)
        return
      }
      reportProjectDeviceUnavailable(null)
      void (async () => {
        const g = getProjectReadyGeneration()
        const armed = await audioEngine.armNativeMixOutput()
        reportProjectDevice(Boolean(armed), armed ? 'Motor de audio recuperado' : 'rearm fail', g)
        // Los instrumentos que se añadieron con el motor ocupado fallaron (AudioEngineBusy): se cargan ahora,
        // si no la pista quedaba muda aunque el catálogo dijera «añadido».
        const st = getSharedStore().obtenerEstado()
        const { ensureProjectVstInstruments, olvidarFallosPorMotorOcupado } = await import(
          '@/src/lib/plugin/track-vst-runtime'
        )
        olvidarFallosPorMotorOcupado()
        await ensureProjectVstInstruments(
          (st.project?.tracks ?? []).map((t) => ({ id: t.id, plugins: t.plugins })),
          st.project?.master?.plugins,
        ).catch(() => undefined)
      })()
    })
    // Otra ventana pulsó «Usar audio aquí»: se para el transporte (y se escribe una toma en curso) antes de ceder.
    const offCeder = window.electron?.onAudioEngineReleaseRequested?.(() => {
      void (async () => {
        try {
          const { detenerTransporteYFinalizarGrabacion } = await import('@/src/lib/project-io')
          await detenerTransporteYFinalizarGrabacion(getSharedStore())
        } catch (err) {
          console.warn('[audio] no se pudo parar el transporte antes de ceder el motor', err)
        }
        await window.electron?.audioEngineRelease?.()
      })()
    })
    return () => {
      registrarSondaHost(null)
      offExit?.()
      offRestart?.()
      offBusy?.()
      offCeder?.()
      dejarDeOirCuarentena?.()
      dejarDeSincronizar()
    }
  }, [])
  return null
}

/**
 * Panel IU de plugin (workspace tab `plugin-editor`).
 * VST3/Roles: misma instancia (createView + process) en plugin-host.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ExternalLink, Piano, RefreshCw, Sparkles, Waves, X } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
import { audioEngine } from '@/lib/audio-engine'
import {
  getPluginEditorFocus,
  subscribePluginEditorFocus,
} from '@/src/lib/plugin/plugin-editor-store'
import { createElectronPluginHostBridge } from '@/src/lib/plugin/electron-bridge-client'
import {
  setActiveVstVoiceTarget,
  setForceBuiltinPreview,
} from '@/src/lib/plugin/vst-voice-router'
import {
  ensureTrackVstInstrument,
  getLastVstLoadError,
  isVstQuarantineError,
  resolveHostPluginPath,
  slotIdForTrackPlugin,
} from '@/src/lib/plugin/track-vst-runtime'
import { requestOpenTool } from '@/src/workspace/types'
import { JASWAVE_ROLES_NAME } from '@/src/lib/plugin/jaswave-roles'
import { JasWaveRolesPanel } from '@/components/jaswave-roles-panel'

function useEditorFocus() {
  return useSyncExternalStore(subscribePluginEditorFocus, getPluginEditorFocus, () => null)
}

type EditorStatus = 'idle' | 'opening' | 'open' | 'error'

function VstNativeEditor({
  plugin,
  trackId,
}: {
  plugin: PluginInfo
  trackId: string
}) {
  const tienda = useDAW()
  const [status, setStatus] = useState<EditorStatus>('idle')
  const [message, setMessage] = useState<string>('')
  const hostRef = useRef<HTMLDivElement>(null)
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  const pluginPath = resolveHostPluginPath(plugin)
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72]
  const isRoles = plugin.nombre.includes(JASWAVE_ROLES_NAME) || /jaswave\s*roles/i.test(plugin.nombre)
  const openedOnce = useRef(false)
  const [clearingQuarantine, setClearingQuarantine] = useState(false)
  const quarantineBlocked = status === 'error' && isVstQuarantineError(message)

  async function clearQuarantineAndRetry() {
    setClearingQuarantine(true)
    try {
      const { clearPluginQuarantineAndRestore } = await import('@/src/lib/audio-device-cli')
      const r = await clearPluginQuarantineAndRestore(tienda)
      setMessage(r.message)
      openedOnce.current = false
      await openEditor()
    } catch (e) {
      setStatus('error')
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setClearingQuarantine(false)
    }
  }

  /** Persiste ruta en el proyecto si faltaba (inserts viejos / agent). */
  function persistPathIfNeeded(path: string) {
    if (!path || (plugin.descripcion || '').includes(path)) return
    tienda.establecerEstado((s) => {
      const tracks = (s.project?.tracks ?? []).map((t) => {
        if (t.id !== trackId) return t
        return {
          ...t,
          plugins: (t.plugins ?? []).map((p) =>
            p.id === plugin.id ? { ...p, descripcion: path } : p,
          ),
        }
      })
      return { ...s, project: { ...s.project!, tracks } }
    })
  }

  async function openEditor() {
    const path = resolveHostPluginPath(plugin)
    if (!path) {
      setStatus('error')
      setMessage(
        'Este plugin no tiene ruta .vst3/.dll. Vuelve a insertarlo desde Instrumentos (así guarda el path).',
      )
      return
    }
    persistPathIfNeeded(path)
    setStatus('opening')
    setMessage('Cargando audio en el Plugin Host…')
    setForceBuiltinPreview(false)
    const loaded = await ensureTrackVstInstrument(trackId, { ...plugin, descripcion: path })
    if (!loaded) {
      setStatus('error')
      setMessage(
        `No se pudo cargar el VST en el host.\n${getLastVstLoadError() || path}`,
      )
      return
    }
    setMessage('Abriendo UI nativa…')
    const bridge = createElectronPluginHostBridge()
    const reply = await bridge.send({
      type: 'openEditor',
      path,
      slotId,
      pluginId: plugin.id,
    })
    if (reply.ok) {
      setStatus('open')
      setMessage(
        'UI y audio son la misma instancia. El teclado del plugin debe sonar por el driver de Configuración → Audio.',
      )
    } else {
      setStatus('error')
      setMessage(reply.message || 'No se pudo abrir el editor VST')
    }
  }

  async function closeEditor() {
    const bridge = createElectronPluginHostBridge()
    await bridge.send({ type: 'closeEditor', slotId })
    setActiveVstVoiceTarget(null)
    setStatus('idle')
    setMessage('')
    openedOnce.current = false
  }

  useEffect(() => {
    openedOnce.current = false
    void (async () => {
      const path = resolveHostPluginPath(plugin)
      if (!path) {
        setStatus('error')
        setMessage(
          'MISSING · sin ruta de plugin. Quita DecentSampler e insértalo de nuevo desde el catálogo.',
        )
        return
      }
      persistPathIfNeeded(path)
      setStatus('idle')
      setForceBuiltinPreview(false)
      setMessage('Cargando audio VST en el Plugin Host…')
      const ok = await ensureTrackVstInstrument(trackId, { ...plugin, descripcion: path })
      if (!ok) {
        setStatus('error')
        setMessage(
          getLastVstLoadError() ||
            'Host no cargó este VST. Reinserta el plugin o revisa cuarentena.',
        )
        return
      }
      setMessage(
        isRoles
          ? 'JasWave Roles listo. Abriendo UI…'
          : 'Host listo. Abriendo UI nativa…',
      )
      if (!openedOnce.current) {
        openedOnce.current = true
        await openEditor()
      }
    })()
    return () => {
      setActiveVstVoiceTarget(null)
      void createElectronPluginHostBridge().send({ type: 'closeEditor', slotId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Waves className="size-3.5 text-accent-amber" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{plugin.nombre}</div>
          <div className="truncate text-[9px] text-muted-foreground">
            {status === 'open'
              ? 'UI nativa · misma instancia que el audio'
              : status === 'opening'
                ? 'Abriendo…'
                : status === 'error'
                  ? message
                  : isRoles
                    ? 'JasWave Roles VST'
                    : 'VST3'}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void openEditor()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-border hover:text-foreground"
        >
          <RefreshCw className="size-3" />
          Reabrir
        </button>
        <button
          type="button"
          onClick={() => void closeEditor()}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-border hover:text-foreground"
        >
          <X className="size-3" />
          Cerrar UI
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border px-3 py-1.5">
        {pitches.map((pitch) => (
          <button
            key={pitch}
            type="button"
            onPointerDown={() => {
              void audioEngine.ensureContext().resume()
              audioEngine.noteOn(pitch, 100)
            }}
            onPointerUp={() => {
              audioEngine.noteOff(pitch)
            }}
            onPointerLeave={() => {
              audioEngine.noteOff(pitch)
            }}
            className="rounded bg-background px-2 py-1 font-mono text-[10px] text-foreground ring-1 ring-border hover:ring-accent-amber"
          >
            {pitch}
          </button>
        ))}
      </div>

      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 bg-black"
        data-vst-embed-host={slotId}
      >
        {status !== 'open' ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[11px] text-muted-foreground">
            <p className="max-w-lg whitespace-pre-wrap">{message || 'Cargando host de audio…'}</p>
            {quarantineBlocked ? (
              <div className="flex max-w-md flex-col items-center gap-2">
                <p className="text-[10px] text-muted-foreground/90">
                  Reaper puede cargar DecentSampler sin problema; JasWave lo aisló tras un crash previo del Plugin Host. Limpia la cuarentena y reintenta.
                </p>
                <button
                  type="button"
                  disabled={clearingQuarantine}
                  onClick={() => void clearQuarantineAndRetry()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-accent-amber px-3 py-1.5 text-[11px] font-semibold text-background disabled:opacity-50"
                >
                  <RefreshCw className={`size-3 ${clearingQuarantine ? 'animate-spin' : ''}`} />
                  {clearingQuarantine ? 'Limpiando…' : 'Limpiar cuarentena y reintentar'}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground/80">
            UI nativa abierta en ventana flotante (mismo VST que el audio).
          </div>
        )}
      </div>

      {pluginPath ? (
        <p className="truncate border-t border-border px-3 py-1 text-[9px] text-muted-foreground/70" title={pluginPath}>
          {pluginPath}
        </p>
      ) : null}
    </div>
  )
}

export function PluginEditorPanel() {
  const focus = useEditorFocus()
  const tienda = useDAW()
  const plugin = useDAWState((s: DAWState) => {
    if (!focus) return null
    const track = s.project?.tracks?.find((t) => t.id === focus.trackId)
    return (track?.plugins ?? []).find((p) => p.id === focus.pluginId) ?? null
  })
  const trackName = useDAWState((s: DAWState) => {
    if (!focus) return null
    return s.project?.tracks?.find((t) => t.id === focus.trackId)?.nombre ?? null
  })

  if (!focus || !plugin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center">
        <Piano className="size-8 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">
          Abre un instrumento desde la pista o el catálogo para ver su UI aquí.
        </p>
        <button
          type="button"
          onClick={() => requestOpenTool('instruments', { zone: 'left' })}
          className="text-[11px] text-accent-amber hover:underline"
        >
          Ir a Instrumentos
        </button>
      </div>
    )
  }

  const isRoles =
    plugin.nombre.includes(JASWAVE_ROLES_NAME) || /jaswave\s*roles/i.test(plugin.nombre)

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Sparkles className="size-3.5 shrink-0 text-accent-amber" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{plugin.nombre}</div>
          <div className="truncate text-[9px] text-muted-foreground">
            {trackName ? `Pista · ${trackName}` : 'Editor de plugin'}
            {isRoles ? ' · Roles VST3 (UI JasWave)' : ' · UI+audio misma instancia'}
          </div>
        </div>
        <button
          type="button"
          title="Abrir inspector de pista"
          onClick={() => {
            void tienda.executor.execute('selection.set', {
              tipo: 'pista',
              ids: [focus.trackId],
              idsPistas: [focus.trackId],
              idsClips: [],
              idPrincipal: focus.trackId,
              limpiar: true,
            })
            requestOpenTool('track-detail', { zone: 'right' })
          }}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="size-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isRoles ? (
          <JasWaveRolesPanel trackId={focus.trackId} plugin={plugin} initialRole={trackName ?? undefined} />
        ) : (
          <VstNativeEditor plugin={plugin} trackId={focus.trackId} />
        )}
      </div>
    </div>
  )
}

export function usePluginEditorTabTitle(): string | null {
  const focus = useEditorFocus()
  return focus?.pluginName ?? null
}

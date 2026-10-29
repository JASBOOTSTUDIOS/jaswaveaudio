/**
 * Panel IU de plugin (workspace tab `plugin-editor`).
 * Escritorio: SIEMPRE el editor nativo del VST (misma instancia que el audio en el plugin-host),
 * embebido en el panel (V4). Los VST de JasWave muestran aquí su editor cyber; no hay paneles web
 * distintos. Si el plugin no admite el modo embebido, se abre en ventana flotante.
 * Web: la réplica del mismo editor que aporta el módulo «Editores de VST» (servicio `editorPlugin`).
 */

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { AppWindow, ExternalLink, PanelTop, Piano, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Waves, X } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
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
  ensureHostMidiAudible,
  ensureTrackVstInstrument,
  getLastVstLoadError,
  isVstQuarantineError,
  resolveHostPluginPath,
  slotIdForTrackPlugin,
} from '@/src/lib/plugin/track-vst-runtime'
import { requestOpenTool } from '@/src/workspace/types'
import { JASWAVE_ROLES_NAME } from '@/src/lib/plugin/jaswave-roles'
import { isJasWaveFxPlugin } from '@/src/lib/plugin/bundled-plugins'
import type { EditorEmbedRect } from '@/src/lib/plugin/types'
import { servicioDeModulo } from '@/src/modulos/contribuciones'
import { PluginControlPanel } from '@/components/plugin-control-panel'
import { accionPluginUsuario } from '@/src/lib/plugin/plugin-ui-acciones'
import { useVersionModulos } from '@/src/modulos/use-modulos'

function useEditorFocus() {
  return useSyncExternalStore(subscribePluginEditorFocus, getPluginEditorFocus, () => null)
}

type EditorStatus = 'idle' | 'opening' | 'open' | 'error'
type EditorMode = 'embebido' | 'flotante'

/**
 * Rectángulo VISIBLE del panel en px CSS: la caja del elemento recortada por todos los contenedores con
 * overflow (zonas con scroll, paneles aplastados) y por la ventana. La ventana nativa del plugin no la
 * recorta nadie, así que si usáramos la caja completa se desbordaría fuera del panel y de la app.
 * Invisible si está oculto o si lo que queda a la vista es demasiado pequeño para ser útil.
 */
export function embedRectOf(el: HTMLElement | null): EditorEmbedRect {
  if (!el || !el.isConnected) return { x: 0, y: 0, w: 0, h: 0, visible: false }
  const r = el.getBoundingClientRect()
  let left = r.left, top = r.top, right = r.right, bottom = r.bottom
  for (let p = el.parentElement; p; p = p.parentElement) {
    const cs = getComputedStyle(p)
    if (/(hidden|auto|scroll|clip)/.test(cs.overflowX) || /(hidden|auto|scroll|clip)/.test(cs.overflowY)) {
      const pr = p.getBoundingClientRect()
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowX)) { left = Math.max(left, pr.left); right = Math.min(right, pr.right) }
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowY)) { top = Math.max(top, pr.top); bottom = Math.min(bottom, pr.bottom) }
    }
  }
  left = Math.max(left, 0); top = Math.max(top, 0)
  right = Math.min(right, window.innerWidth); bottom = Math.min(bottom, window.innerHeight)
  const w = Math.max(0, right - left), h = Math.max(0, bottom - top)
  const visible = w >= 40 && h >= 40 && document.visibilityState === 'visible' && el.offsetParent !== null
  return { x: left, y: top, w, h, visible }
}

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
  const [mode, setMode] = useState<EditorMode>('embebido')
  const modeRef = useRef<EditorMode>('embebido')
  const [clearingQuarantine, setClearingQuarantine] = useState(false)
  const [controles, setControles] = useState(false)
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

  async function openEditor(nextMode: EditorMode = modeRef.current) {
    modeRef.current = nextMode
    setMode(nextMode)
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
    const embed = nextMode === 'embebido' ? embedRectOf(hostRef.current) : undefined
    let reply = await bridge.send({ type: 'openEditor', path, slotId, pluginId: plugin.id, ...(embed ? { embed } : {}) })
    if (!reply.ok && embed) {
      // el plugin no admite el modo embebido (p. ej. VST2): ventana flotante
      modeRef.current = 'flotante'
      setMode('flotante')
      reply = await bridge.send({ type: 'openEditor', path, slotId, pluginId: plugin.id })
    }
    if (reply.ok) {
      // el teclado del propio editor toca el VST: la salida de audio nativa tiene que estar en marcha
      void ensureHostMidiAudible()
      setStatus('open')
      setMessage(
        'UI y audio son la misma instancia. El teclado del plugin debe sonar por el driver de Configuración → Audio.',
      )
    } else {
      setStatus('error')
      setMessage(reply.message || 'No se pudo abrir el editor VST')
    }
  }

  // Mantiene el editor embebido alineado con el panel (tamaño, scroll, pestaña oculta, zoom)
  useEffect(() => {
    if (status !== 'open' || mode !== 'embebido') return
    const el = hostRef.current
    if (!el) return
    const bridge = createElectronPluginHostBridge()
    let frame = 0
    let last = ''
    const sync = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const embed = embedRectOf(el)
        const key = `${Math.round(embed.x)},${Math.round(embed.y)},${Math.round(embed.w)},${Math.round(embed.h)},${embed.visible}`
        if (key === last) return
        last = key
        void bridge.send({ type: 'setEditorBounds', slotId, embed })
      })
    }
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    const io = new IntersectionObserver(sync)
    io.observe(el)
    window.addEventListener('resize', sync)
    window.addEventListener('scroll', sync, true)
    document.addEventListener('visibilitychange', sync)
    const poll = window.setInterval(sync, 500) // el layout puede mover el panel sin cambiar su tamaño
    sync()
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      io.disconnect()
      window.removeEventListener('resize', sync)
      window.removeEventListener('scroll', sync, true)
      document.removeEventListener('visibilitychange', sync)
      window.clearInterval(poll)
    }
  }, [status, mode, slotId])

  async function closeEditor() {
    try {
      const { snapshotTrackPluginIntoProject } = await import('@/src/lib/plugin/track-vst-runtime')
      await snapshotTrackPluginIntoProject(tienda, trackId, plugin.id)
    } catch {
      /* best-effort: no bloquear cierre */
    }
    const bridge = createElectronPluginHostBridge()
    await bridge.send({ type: 'closeEditor', slotId })
    setActiveVstVoiceTarget(null)
    setStatus('idle')
    openedOnce.current = false
  }

  /** Valores por defecto que reporta el VST, con deshacer (la misma acción que puede usar la IA). */
  async function resetToDefault() {
    const r = await accionPluginUsuario(tienda, 'plugin.resetDefaults', { trackId, pluginInstanceId: plugin.id })
    setMessage(r.message)
  }

  /** Teclas de prueba: MIDI directo a ESTE VST (no al sintetizador interno ni a otra pista). */
  function probarNota(pitch: number, on: boolean) {
    const api = window.electron
    const cmd = on ? { type: 'noteOn' as const, slotId, pitch, velocity: 100 } : { type: 'noteOff' as const, slotId, pitch }
    if (typeof api?.pluginHostMidi === 'function') void api.pluginHostMidi(cmd)
    else void api?.pluginHostSend?.(cmd)
    if (on) void ensureHostMidiAudible()
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
      void (async () => {
        try {
          const { snapshotTrackPluginIntoProject } = await import('@/src/lib/plugin/track-vst-runtime')
          await snapshotTrackPluginIntoProject(tienda, trackId, plugin.id)
        } catch {
          /* ignore */
        }
        await createElectronPluginHostBridge().send({ type: 'closeEditor', slotId })
      })()
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
              ? mode === 'embebido'
                ? 'UI nativa embebida · misma instancia que el audio'
                : 'UI nativa en ventana · misma instancia que el audio'
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
          aria-pressed={controles}
          onClick={() => setControles((v) => !v)}
          title="Parámetros, presets y herramientas del plugin (lo mismo que puede hacer la IA)"
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] ring-1 ring-border hover:text-foreground ${controles ? 'text-accent-amber' : 'text-muted-foreground'}`}
        >
          <SlidersHorizontal className="size-3" />
          Controles
        </button>
        <button
          type="button"
          onClick={() => void resetToDefault()}
          title="Restablecer todos los parámetros del VST a sus valores por defecto (con deshacer)"
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-border hover:text-accent-amber"
        >
          <RotateCcw className="size-3" />
          Restablecer
        </button>
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
          title={mode === 'embebido' ? 'Abrir el editor en una ventana aparte' : 'Volver a mostrar el editor dentro del panel'}
          onClick={() => void openEditor(mode === 'embebido' ? 'flotante' : 'embebido')}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-border hover:text-foreground"
        >
          {mode === 'embebido' ? <AppWindow className="size-3" /> : <PanelTop className="size-3" />}
          {mode === 'embebido' ? 'En ventana' : 'En el panel'}
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
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              probarNota(pitch, true)
            }}
            onPointerUp={() => probarNota(pitch, false)}
            onPointerCancel={() => probarNota(pitch, false)}
            className="rounded bg-background px-2 py-1 font-mono text-[10px] text-foreground ring-1 ring-border hover:ring-accent-amber"
          >
            {pitch}
          </button>
        ))}
      </div>

      {controles ? (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-border px-3 py-1.5">
          <PluginControlPanel trackId={trackId} plugin={plugin} />
        </div>
      ) : null}

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
        ) : mode === 'flotante' ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground/80">
            UI nativa abierta en ventana flotante (mismo VST que el audio).
          </div>
        ) : null}
      </div>

      {pluginPath ? (
        <p className="truncate border-t border-border px-3 py-1 text-[9px] text-muted-foreground/70" title={pluginPath}>
          {pluginPath}
        </p>
      ) : null}
    </div>
  )
}

/** Web: no hay plugin-host; el editor lo pone un módulo (réplica del editor nativo) si lo soporta. */
function EditorPluginWeb({ plugin, trackId }: { plugin: PluginInfo; trackId: string }) {
  useVersionModulos()
  const servicio = servicioDeModulo('editorPlugin')
  if (servicio?.soporta({ nombre: plugin.nombre })) {
    const Componente = servicio.Componente
    return <Componente trackId={trackId} pluginInstanceId={plugin.id} />
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-[11px] text-muted-foreground">
      <p>El editor de «{plugin.nombre}» está disponible en la app de escritorio.</p>
      <p className="text-[10px]">Los VST de JasWave también se editan aquí con el módulo «Editores de VST» (Módulos).</p>
      <button type="button" onClick={() => requestOpenTool('modulos')} className="text-[11px] text-accent-amber hover:underline">
        Ir a Módulos
      </button>
    </div>
  )
}

export function PluginEditorPanel() {
  const focus = useEditorFocus()
  const tienda = useDAW()
  const pluginFromProject = useDAWState((s: DAWState) => {
    if (!focus) return null
    const track = s.project?.tracks?.find((t) => t.id === focus.trackId)
    return (track?.plugins ?? []).find((p) => p.id === focus.pluginId) ?? null
  })
  const plugin = pluginFromProject ?? focus?.pluginSnapshot ?? null
  const trackName = useDAWState((s: DAWState) => {
    if (!focus) return null
    return s.project?.tracks?.find((t) => t.id === focus.trackId)?.nombre ?? null
  })

  if (!focus || !plugin) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center">
        <Piano className="size-8 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">
          Abre un instrumento desde la pista, el catálogo o «Configurar VST» en una vista previa.
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
  const isJasWave = isRoles || isJasWaveFxPlugin(plugin)

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Sparkles className="size-3.5 shrink-0 text-accent-amber" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{plugin.nombre}</div>
          <div className="truncate text-[9px] text-muted-foreground">
            {trackName
              ? `Pista · ${trackName}`
              : focus.trackId.startsWith('__')
                ? 'Audición de vista previa'
                : 'Editor de plugin'}
            {isJasWave ? ' · VST3 JasWave (editor cyber nativo)' : ' · UI+audio misma instancia'}
          </div>
        </div>
        <button
          type="button"
          title="Abrir inspector de pista"
          onClick={() => {
            if (focus.trackId.startsWith('__')) {
              requestOpenTool('instruments', { zone: 'left' })
              return
            }
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
        {typeof window !== 'undefined' && window.electron?.pluginsListar ? (
          <VstNativeEditor plugin={plugin} trackId={focus.trackId} />
        ) : (
          <EditorPluginWeb plugin={plugin} trackId={focus.trackId} />
        )}
      </div>
    </div>
  )
}

export function usePluginEditorTabTitle(): string | null {
  const focus = useEditorFocus()
  return focus?.pluginName ?? null
}

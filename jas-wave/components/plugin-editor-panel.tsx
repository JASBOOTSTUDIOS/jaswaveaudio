/**
 * Panel IU de plugin (workspace tab `plugin-editor`).
 * Soft Pad: UI React + Web Audio. VST3: misma instancia (createView + process) en plugin-host.
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
  extractHostPluginPath,
  getLastVstLoadError,
  slotIdForTrackPlugin,
} from '@/src/lib/plugin/track-vst-runtime'
import { requestOpenTool } from '@/src/workspace/types'

function useEditorFocus() {
  return useSyncExternalStore(subscribePluginEditorFocus, getPluginEditorFocus, () => null)
}

function SoftPadEditor({ plugin }: { plugin: PluginInfo }) {
  const [gain, setGain] = useState(0.35)
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72]

  useEffect(() => {
    setForceBuiltinPreview(true)
    setActiveVstVoiceTarget(null)
    void audioEngine.ensureContext().resume()
    return () => setForceBuiltinPreview(false)
  }, [])

  const play = async (pitch: number) => {
    const ctx = audioEngine.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()
    audioEngine.noteOn(pitch, 100)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 text-accent-amber" />
        <div>
          <div className="text-[14px] font-semibold text-foreground">{plugin.nombre}</div>
          <p className="text-[11px] text-muted-foreground">Editor in-process · JasWave Soft Pad</p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
        Nivel
        <input
          type="range"
          min={0.05}
          max={0.8}
          step={0.01}
          value={gain}
          onChange={(e) => {
            const v = Number(e.target.value)
            setGain(v)
            audioEngine.setSynthGain(v)
          }}
          className="flex-1"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        {pitches.map((pitch) => (
          <button
            key={pitch}
            type="button"
            onPointerDown={() => void play(pitch)}
            onPointerUp={() => audioEngine.noteOff(pitch)}
            onPointerLeave={() => audioEngine.noteOff(pitch)}
            className="rounded-md bg-background px-2.5 py-2 font-mono text-[11px] text-foreground ring-1 ring-border hover:ring-accent-amber"
          >
            {pitch}
          </button>
        ))}
      </div>
    </div>
  )
}

type EditorStatus = 'idle' | 'opening' | 'open' | 'error'

function VstNativeEditor({
  plugin,
  trackId,
}: {
  plugin: PluginInfo
  trackId: string
}) {
  const [status, setStatus] = useState<EditorStatus>('idle')
  const [message, setMessage] = useState<string>('')
  const hostRef = useRef<HTMLDivElement>(null)
  const slotId = slotIdForTrackPlugin(trackId, plugin.id)
  const pluginPath = extractHostPluginPath(plugin.descripcion ?? '')
  const pitches = [60, 62, 64, 65, 67, 69, 71, 72]

  function readBounds() {
    const el = hostRef.current
    if (!el) return { x: 0, y: 48, w: 800, h: 500 }
    const r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.max(120, Math.round(r.width)),
      h: Math.max(120, Math.round(r.height)),
    }
  }

  async function openEditor() {
    if (!pluginPath) {
      setStatus('error')
      setMessage('Este plugin no tiene ruta de plugin (.vst3/.dll) en el proyecto (MISSING).')
      return
    }
    setStatus('opening')
    setMessage('Cargando audio en el Plugin Host…')
    setForceBuiltinPreview(false)
    const loaded = await ensureTrackVstInstrument(trackId, plugin)
    if (!loaded) {
      setStatus('error')
      setMessage(`No se pudo cargar el VST en el host de audio.\n${pluginPath}`)
      return
    }
    setMessage('Abriendo UI nativa de esta instancia (mismo VST que suena)…')
    const bridge = createElectronPluginHostBridge()
    const reply = await bridge.send({
      type: 'openEditor',
      path: pluginPath,
      slotId,
      pluginId: plugin.id,
    })
    if (reply.ok) {
      setStatus('open')
      setMessage(
        'UI y audio son la misma instancia. El teclado del plugin debe sonar por el driver seleccionado en Configuración → Audio.',
      )
    } else {
      setStatus('error')
      setMessage(reply.message || 'No se pudo abrir el editor VST')
    }
  }

  async function syncBounds() {
    if (status !== 'open') return
    const bridge = createElectronPluginHostBridge()
    const b = readBounds()
    await bridge.send({
      type: 'setEditorBounds',
      slotId,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
    })
  }

  async function closeEditor() {
    const bridge = createElectronPluginHostBridge()
    await bridge.send({ type: 'closeEditor', slotId })
    setActiveVstVoiceTarget(null)
    setStatus('idle')
    setMessage('')
  }

  useEffect(() => {
    void (async () => {
      if (!pluginPath) return
      setStatus('idle')
      setForceBuiltinPreview(false)
      setMessage('Cargando audio VST en el Plugin Host…')
      const ok = await ensureTrackVstInstrument(trackId, plugin)
      setMessage(
        ok
          ? 'Host listo. Reabrir abre la UI de ESTA instancia (preset = sonido). Teclas del panel → MIDI al VST.'
          : getLastVstLoadError() ||
            'Host no cargó este VST. Si tumbó el proceso (p.ej. BFD), queda aislado y el audio sigue en WASAPI.',
      )
    })()
    return () => {
      setActiveVstVoiceTarget(null)
      void createElectronPluginHostBridge().send({ type: 'closeEditor', slotId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, pluginPath])

  useEffect(() => {
    // No syncBounds agresivo — evita saturar la cola del host
  }, [status, slotId])

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

      {/* Superficie donde se embebe el HWND del plugin */}
      <div
        ref={hostRef}
        className="relative min-h-0 flex-1 bg-black"
        data-vst-embed-host={slotId}
      >
        {status !== 'open' ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
            {message || 'Cargando host de audio…'}
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

  const isSoftPad = plugin.nombre.includes('Soft Pad') || plugin.licencia === 'interno'

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Sparkles className="size-3.5 shrink-0 text-accent-amber" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{plugin.nombre}</div>
          <div className="truncate text-[9px] text-muted-foreground">
            {trackName ? `Pista · ${trackName}` : 'Editor de plugin'}
            {isSoftPad ? ' · audible' : ' · UI+audio misma instancia'}
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
        {isSoftPad ? (
          <SoftPadEditor plugin={plugin} />
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

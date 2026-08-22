/**
 * Panel FX Chain por pista / Master (ADR-0012) — workspace tool `fx-chain`.
 */

import { useSyncExternalStore, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  Plus,
  Replace,
  Sparkles,
  Trash2,
  Waves,
} from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
import {
  getFxChainFocus,
  openFxChain,
  subscribeFxChainFocus,
} from '@/src/lib/plugin/fx-chain-store'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import { selectTrackPayload } from '@/src/lib/selection-helpers'
import { requestOpenTool } from '@/src/workspace/types'
import { hydratePluginCatalog } from '@/src/lib/plugin/catalog-store'
import { pluginManager } from '@/src/lib/plugin-host'
import {
  descriptorToPluginInfo,
  softPadPluginInfo,
} from '@/src/lib/plugin/plugin-info-adapter'
import type { PluginDescriptor } from '@/src/lib/plugin/types'
import { audioEngine } from '@/lib/audio-engine'
import { MASTER_FX_TRACK_ID, getFxChainClipboard } from '../../shared/src/commands/plugin-commands'

function useFxFocus() {
  return useSyncExternalStore(subscribeFxChainFocus, getFxChainFocus, () => null)
}

function isInstrument(p: PluginInfo): boolean {
  return p.tipo === 'instrumento' || p.categoria === 'synth' || p.categoria === 'instrumento'
}

function isMissing(p: PluginInfo): boolean {
  return p.estado === 'pendiente' || p.estado === 'error' || /missing|faltante/i.test(p.nombre)
}

export function FxChainPanel() {
  const focus = useFxFocus()
  const tienda = useDAW()
  const track = useDAWState((s: DAWState) => {
    if (!focus) return null
    if (focus.trackId === MASTER_FX_TRACK_ID || focus.trackId === '__master__') {
      return {
        id: MASTER_FX_TRACK_ID,
        nombre: 'Master',
        plugins: s.project?.master?.plugins ?? [],
      }
    }
    return s.project?.tracks?.find((t) => t.id === focus.trackId) ?? null
  })
  const [catalog, setCatalog] = useState<PluginDescriptor[]>([])
  const [pickId, setPickId] = useState('jaswave.softpad')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    setCatalog(pluginManager.listAvailable())
  }, [focus?.trackId])

  if (!focus || !track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-panel px-4 text-center">
        <Waves className="size-8 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">
          Abre FX desde la cabecera de una pista, el mixer o Master.
        </p>
      </div>
    )
  }

  const plugins = track.plugins ?? []
  const trackId = track.id

  const run = async (type: string, payload: Record<string, unknown>) => {
    setBusy(true)
    setMsg('')
    try {
      await tienda.executor.execute(type, payload)
    } finally {
      setBusy(false)
    }
  }

  const insertSelected = async () => {
    const d = catalog.find((x) => x.pluginId === pickId)
    const info =
      pickId === 'jaswave.softpad' || !d ? softPadPluginInfo() : descriptorToPluginInfo(d)
    setBusy(true)
    try {
      await tienda.executor.execute('plugin.insert', {
        trackId,
        plugin: info,
      })
      if (info.nombre.includes('Soft Pad')) audioEngine.ensureContext()
      openPluginEditor({
        trackId,
        pluginId: info.id,
        pluginName: info.nombre,
        zone: 'right',
      })
    } finally {
      setBusy(false)
    }
  }

  const replaceSelected = async (pluginInstanceId: string) => {
    const d = catalog.find((x) => x.pluginId === pickId)
    const info =
      pickId === 'jaswave.softpad' || !d ? softPadPluginInfo() : descriptorToPluginInfo(d)
    await run('plugin.replace', { trackId, pluginInstanceId, plugin: info })
  }

  const copyChain = async () => {
    await run('fxChain.copy', { trackId })
    setMsg(`Copiados ${getFxChainClipboard().length} plugins`)
  }

  const pasteChain = async () => {
    const clip = getFxChainClipboard()
    if (!clip.length) {
      setMsg('Clipboard vacío — copia primero')
      return
    }
    await run('fxChain.paste', { trackId, plugins: clip })
    setMsg(`Pegados ${clip.length} plugins`)
  }

  const savePreset = async () => {
    const nombre = `FX ${track.nombre}`
    const presetId = `fxpreset-${Date.now().toString(36)}`
    const r = await tienda.executor.execute('fxChain.savePreset', {
      trackId,
      presetId,
      nombre,
    })
    if (r.success && r.result && typeof r.result === 'object') {
      const pluginsSaved = (r.result as { plugins?: PluginInfo[] }).plugins ?? []
      try {
        const key = 'jaswave.fxChainPresets'
        const prev = JSON.parse(localStorage.getItem(key) || '[]') as unknown[]
        prev.push({ presetId, nombre, trackHint: track.nombre, plugins: pluginsSaved, at: Date.now() })
        localStorage.setItem(key, JSON.stringify(prev.slice(-40)))
        setMsg(`Preset guardado: ${nombre}`)
      } catch {
        setMsg('Preset serializado (sin localStorage)')
      }
    }
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          {track.nombre} — FX Chain
        </span>
        <span className="text-[10px] text-muted-foreground">{plugins.length} plugs</span>
        <button
          type="button"
          disabled={busy}
          title="Copiar cadena"
          onClick={() => void copyChain()}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={busy}
          title="Pegar cadena"
          onClick={() => void pasteChain()}
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ClipboardPaste className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {plugins.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-[11px] text-muted-foreground">
            Cadena vacía. Añade un instrumento o efecto abajo.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {plugins.map((p, index) => (
              <li
                key={p.id}
                className={`flex items-start gap-2 rounded-md border px-2 py-2 ${
                  isMissing(p)
                    ? 'border-destructive/50 bg-destructive/5'
                    : isInstrument(p)
                      ? 'border-accent-amber/40 bg-accent-amber/5'
                      : 'border-border bg-panel-raised/50'
                } ${p.bypass ? 'opacity-55' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={!p.bypass}
                  disabled={busy}
                  title={p.bypass ? 'Activar' : 'Bypass'}
                  onChange={() =>
                    void run('plugin.bypass', {
                      trackId,
                      pluginInstanceId: p.id,
                      bypass: !p.bypass,
                    })
                  }
                  className="mt-1"
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  onClick={() =>
                    openPluginEditor({
                      trackId,
                      pluginId: p.id,
                      pluginName: p.nombre,
                      zone: 'right',
                    })
                  }
                >
                  <div className="flex items-center gap-1">
                    <Sparkles className="size-3 shrink-0 text-accent-amber" />
                    <span className="truncate text-[12px] font-semibold text-foreground">
                      {isMissing(p) ? `[MISSING] ${p.nombre}` : p.nombre}
                    </span>
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {isInstrument(p) ? 'Instrument' : 'Audio FX'} · {p.fabricante} · {p.estado}
                    {p.latencia ? ` · ${p.latencia} smp` : ''}
                    {p.wet != null && p.wet < 1 ? ` · wet ${Math.round(p.wet * 100)}%` : ''}
                  </div>
                </button>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    title="Subir"
                    onClick={() =>
                      void run('plugin.move', {
                        trackId,
                        pluginInstanceId: p.id,
                        toIndex: index - 1,
                      })
                    }
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={busy || index >= plugins.length - 1}
                    title="Bajar"
                    onClick={() =>
                      void run('plugin.move', {
                        trackId,
                        pluginInstanceId: p.id,
                        toIndex: index + 1,
                      })
                    }
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ChevronDown className="size-3.5" />
                  </button>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  title="Reemplazar con el seleccionado abajo"
                  onClick={() => void replaceSelected(p.id)}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Replace className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Duplicar"
                  onClick={() =>
                    void run('plugin.duplicate', {
                      trackId,
                      pluginInstanceId: p.id,
                    })
                  }
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="size-3.5" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  title="Eliminar"
                  onClick={() =>
                    void run('plugin.remove', {
                      trackId,
                      pluginInstanceId: p.id,
                    })
                  }
                  className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border p-2">
        {msg ? <p className="mb-1 text-[10px] text-muted-foreground">{msg}</p> : null}
        <div className="mb-1 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            + Add FX
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void savePreset()}
            className="text-[10px] text-accent-amber hover:underline"
          >
            Guardar preset cadena
          </button>
        </div>
        <div className="flex gap-1">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
          >
            {catalog.map((d) => (
              <option key={d.pluginId} value={d.pluginId}>
                {d.name}
                {d.format === 'vst3' ? ' (VST3)' : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => void insertSelected()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/15 px-2 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/25 disabled:opacity-50"
          >
            <Plus className="size-3" />
            Insert
          </button>
        </div>
        <button
          type="button"
          onClick={() => requestOpenTool('instruments', { zone: 'left' })}
          className="mt-1.5 text-[10px] text-accent-amber hover:underline"
        >
          Catálogo / carpetas…
        </button>
      </div>
    </div>
  )
}

/** Botón compacto FX en cabecera de pista / mixer / master. */
export function TrackFxButton({
  trackId,
  trackName,
  count,
}: {
  trackId: string
  trackName: string
  count: number
}) {
  const tienda = useDAW()
  return (
    <button
      type="button"
      title={`FX Chain · ${trackName}`}
      onClick={() => {
        if (trackId !== MASTER_FX_TRACK_ID) {
          void tienda.executor.execute('selection.set', selectTrackPayload(trackId))
        }
        openFxChain(trackId, 'right')
      }}
      className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground ring-1 ring-border hover:text-accent-amber hover:ring-accent-amber/50"
    >
      FX
      {count > 0 ? <span className="tabular-nums text-accent-amber">{count}</span> : null}
    </button>
  )
}

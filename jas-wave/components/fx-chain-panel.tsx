/**
 * Panel FX Chain por pista / Master (ADR-0012) — workspace tool `fx-chain`.
 */

import { useSyncExternalStore, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  FolderOpen,
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
import { pluginManager, catalogPluginInsertable } from '@/src/lib/plugin-host'
import {
  descriptorToPluginInfo,
  extractHostPluginPath,
  isBuiltinPlugin,
  pluginRuntimeCaption,
  VST2_NOT_HOSTED_MSG,
} from '@/src/lib/plugin/plugin-info-adapter'
import type { PluginDescriptor } from '@/src/lib/plugin/types'
import {
  getVstRuntimeGeneration,
  isPluginAudioReady,
  subscribeVstRuntime,
} from '@/src/lib/plugin/track-vst-runtime'
import { isJasWaveRolesDescriptor, jasWaveRolesPluginInfo } from '@/src/lib/plugin/jaswave-roles'
import { MASTER_FX_TRACK_ID, getFxChainClipboard } from '../../shared/src/commands/plugin-commands'
import { libraryApplyPreset, libraryList, librarySaveFxChainGlobal } from '@/src/lib/library/ops'
import type { LibraryPreset } from '@/src/lib/library/preset-catalog'

const EMPTY_PLUGINS: PluginInfo[] = []

function useFxFocus() {
  return useSyncExternalStore(subscribeFxChainFocus, getFxChainFocus, () => null)
}

function useVstRuntimeTick() {
  return useSyncExternalStore(subscribeVstRuntime, getVstRuntimeGeneration, () => 0)
}

function isInstrument(p: PluginInfo): boolean {
  return p.tipo === 'instrumento' || p.categoria === 'synth' || p.categoria === 'instrumento'
}

function isMissing(p: PluginInfo): boolean {
  if (isBuiltinPlugin(p)) return false
  if (/missing|faltante/i.test(p.nombre)) return true
  if (p.estado === 'error') return true
  return !extractHostPluginPath(p.descripcion ?? '')
}

export function FxChainPanel() {
  const focus = useFxFocus()
  useVstRuntimeTick()
  const tienda = useDAW()
  const focusTrackId = focus?.trackId ?? ''
  const isMasterFocus =
    focusTrackId === MASTER_FX_TRACK_ID || focusTrackId === '__master__'
  const masterPlugins = useDAWState((s: DAWState) => s.project?.master?.plugins ?? EMPTY_PLUGINS)
  const focusedTrack = useDAWState((s: DAWState) => {
    if (!focusTrackId || isMasterFocus) return null
    return s.project?.tracks?.find((t) => t.id === focusTrackId) ?? null
  })
  const track = useMemo(() => {
    if (!focus) return null
    if (isMasterFocus) {
      return {
        id: MASTER_FX_TRACK_ID,
        nombre: 'Master',
        plugins: masterPlugins,
      }
    }
    return focusedTrack
  }, [focus, focusedTrack, isMasterFocus, masterPlugins])
  const [catalog, setCatalog] = useState<PluginDescriptor[]>([])
  const [pickId, setPickId] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [fxPresets, setFxPresets] = useState<LibraryPreset[]>([])
  const [loadPresetId, setLoadPresetId] = useState('')

  useEffect(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    const list = pluginManager.listAvailable()
    setCatalog(list)
    setPickId((prev) => {
      if (prev && list.some((x) => x.pluginId === prev)) return prev
      const roles = list.find((x) => isJasWaveRolesDescriptor(x))
      const vst = list.find((x) => x.format === 'vst3')
      return roles?.pluginId ?? vst?.pluginId ?? list[0]?.pluginId ?? ''
    })
    void (async () => {
      const presets = await libraryList(tienda, 'global')
      const chains = presets.filter((p) => (p.type ?? 'plugin') === 'fxChain')
      setFxPresets(chains)
      setLoadPresetId((prev) => (prev && chains.some((p) => p.id === prev) ? prev : chains[0]?.id ?? ''))
    })()
  }, [focus?.trackId, tienda])

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
    const rolesInfo =
      d && isJasWaveRolesDescriptor(d) ? jasWaveRolesPluginInfo() : null
    const info = rolesInfo ?? (d ? descriptorToPluginInfo(d) : null)
    if (!info) return
    if (d && !catalogPluginInsertable(d)) {
      setMsg(
        d.format === 'vst2' && !d.hostReady
          ? VST2_NOT_HOSTED_MSG
          : 'Este plugin no está listo para el host de audio.',
      )
      return
    }
    setBusy(true)
    try {
      await tienda.executor.execute('plugin.insert', {
        trackId,
        plugin: info,
      })
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
    const rolesInfo =
      d && isJasWaveRolesDescriptor(d) ? jasWaveRolesPluginInfo() : null
    const info = rolesInfo ?? (d ? descriptorToPluginInfo(d) : null)
    if (!info) return
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
    const nombre = window.prompt('Nombre del preset de cadena FX (global):', `FX ${track.nombre}`)
    if (!nombre?.trim()) return
    setBusy(true)
    try {
      const r = await librarySaveFxChainGlobal(tienda, {
        trackId,
        nombre: nombre.trim(),
      })
      setMsg(r.message)
      if (r.ok && r.preset) {
        setFxPresets((prev) => [r.preset!, ...prev.filter((p) => p.id !== r.preset!.id)])
        setLoadPresetId(r.preset.id)
      }
    } finally {
      setBusy(false)
    }
  }

  const loadPreset = async () => {
    if (!loadPresetId) {
      setMsg('Sin presets FX globales — guarda una cadena primero')
      return
    }
    setBusy(true)
    try {
      const r = await libraryApplyPreset(tienda, { presetId: loadPresetId, trackId })
      setMsg(r.message)
    } finally {
      setBusy(false)
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
                    {isInstrument(p) ? 'Instrument' : 'Audio FX'} · {p.fabricante}
                    {' · '}
                    {pluginRuntimeCaption(p, {
                      audioReady: isPluginAudioReady(trackId, p.id),
                    })}
                    {p.latencia ? ` · ${p.latencia} smp` : ''}
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
        <p className="mb-1 text-[10px] leading-relaxed text-muted-foreground">
          JasWave Roles (Roles.vst3) u otros VST se insertan desde el catálogo. Un VST en la
          pista envía MIDI al plugin-host cuando el load confirma.
        </p>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            + Add FX
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void savePreset()}
              className="text-[10px] text-accent-amber hover:underline"
            >
              Guardar global
            </button>
          </div>
        </div>
        {fxPresets.length ? (
          <div className="mb-2 flex gap-1">
            <select
              value={loadPresetId}
              onChange={(e) => setLoadPresetId(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[10px]"
            >
              {fxPresets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busy || !loadPresetId}
              title="Cargar preset FX global"
              onClick={() => void loadPreset()}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted"
            >
              <FolderOpen className="size-3" />
              Cargar
            </button>
          </div>
        ) : null}
        <div className="flex gap-1">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-[11px] text-foreground"
          >
            {catalog.map((d) => (
              <option key={d.pluginId} value={d.pluginId}>
                {d.name}
                {d.format === 'vst3' ? ' (VST3)' : d.format === 'vst2' ? ' (VST2)' : ''}
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

import { useCallback, useEffect, useState } from 'react'
import {
  Piano,
  Sparkles,
  Volume2,
  Search,
  Loader2,
  FolderPlus,
  Trash2,
  Folder,
  Plus,
} from 'lucide-react'
import { audioEngine } from '@/lib/audio-engine'
import { requestOpenTool } from '@/src/workspace/types'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import {
  pluginManager,
  refreshPluginHostAvailability,
  type PluginDescriptor,
} from '@/src/lib/plugin-host'
import { hydratePluginCatalog } from '@/src/lib/plugin/catalog-store'
import { descriptorToPluginInfo, softPadPluginInfo } from '@/src/lib/plugin/plugin-info-adapter'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import {
  addCustomScanFolder,
  listScanFolders,
  removeCustomScanFolder,
  setScanFolderEnabled,
} from '@/src/lib/plugin/search-paths-store'
import type { PluginSearchPath } from '@/src/lib/plugin/search-paths'

const WHITE = [60, 62, 64, 65, 67, 69, 71, 72]
const BLACK = [
  { pitch: 61, left: 28 },
  { pitch: 63, left: 60 },
  { pitch: 66, left: 124 },
  { pitch: 68, left: 156 },
  { pitch: 70, left: 188 },
]

function noteLabel(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

async function pickScanFolder(): Promise<string | null> {
  if (window.electron?.dialogOpenDirectory) {
    const result = await window.electron.dialogOpenDirectory()
    if (result.canceled || !result.filePaths?.[0]) return null
    return result.filePaths[0]
  }
  const typed = window.prompt('Ruta de la carpeta con VST3:')
  return typed?.trim() || null
}

/**
 * Panel de instrumentos: Soft Pad + carpetas + catálogo VST3 + añadir a pista.
 */
export function InstrumentsPanel() {
  const tienda = useDAW()
  const selectedTrackId = useDAWState((s: DAWState) => getSelectedTrackId(s))
  const selectedTrackName = useDAWState((s: DAWState) => {
    const id = getSelectedTrackId(s)
    return s.project?.tracks?.find((t) => t.id === id)?.nombre ?? null
  })
  const [held, setHeld] = useState<number | null>(null)
  const [gain, setGain] = useState(0.35)
  const [scanning, setScanning] = useState(false)
  const [vstList, setVstList] = useState<PluginDescriptor[]>([])
  const [scanMsg, setScanMsg] = useState('')
  const [folders, setFolders] = useState<PluginSearchPath[]>(() => listScanFolders())
  const [manualPath, setManualPath] = useState('')

  const refreshCatalogUi = useCallback(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    setVstList(pluginManager.listAvailable().filter((p) => p.format === 'vst3'))
  }, [])

  const syncCapabilities = useCallback(() => {
    const names = pluginManager.listAvailable().map((p) => p.name)
    tienda.establecerEstado((s) => ({
      ...s,
      capabilities: {
        ...s.capabilities,
        pluginsDisponibles: names,
      },
    }))
  }, [tienda])

  const scanVst3 = useCallback(async () => {
    setScanning(true)
    setScanMsg('')
    try {
      await refreshPluginHostAvailability()
      const result = await pluginManager.discoverVst3()
      refreshCatalogUi()
      syncCapabilities()
      setScanMsg(
        result.registered
          ? `${result.registered} VST3 en catálogo (añádelos a una pista desde Inspector → Plugins)`
          : result.error || 'No se encontraron .vst3 en las carpetas habilitadas',
      )
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : 'Error de escaneo')
    } finally {
      setScanning(false)
    }
  }, [refreshCatalogUi, syncCapabilities])

  useEffect(() => {
    refreshCatalogUi()
  }, [refreshCatalogUi])

  const refreshFolders = () => setFolders(listScanFolders())

  const down = async (pitch: number) => {
    setHeld(pitch)
    const { setForceBuiltinPreview } = await import('@/src/lib/plugin/vst-voice-router')
    setForceBuiltinPreview(true)
    const ctx = audioEngine.ensureContext()
    if (ctx.state === 'suspended') await ctx.resume()
    audioEngine.noteOn(pitch, 100)
  }
  const up = (pitch: number) => {
    setHeld(null)
    audioEngine.noteOff(pitch)
  }

  const addFolder = async (path?: string) => {
    const folder = path?.trim() || (await pickScanFolder())
    if (!folder) return
    const entry = addCustomScanFolder(folder)
    refreshFolders()
    if (!entry) {
      setScanMsg('Esa carpeta ya está en la lista de escaneo')
      return
    }
    setManualPath('')
    setScanMsg(`Carpeta añadida. Escaneando…`)
    await scanVst3()
  }

  const addToSelectedTrack = async (d: PluginDescriptor | 'softpad') => {
    if (!selectedTrackId) {
      setScanMsg('Selecciona una pista en el arrangement (icono piano en la cabecera).')
      return
    }
    const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === selectedTrackId)
    if (!track) return
    const info = d === 'softpad' ? softPadPluginInfo() : descriptorToPluginInfo(d)
    await tienda.executor.execute('plugin.insert', {
      trackId: track.id,
      plugin: info,
    })
    if (info.nombre.includes('Soft Pad')) audioEngine.ensureContext()
    else {
      const { ensureTrackVstInstrument } = await import('@/src/lib/plugin/track-vst-runtime')
      void ensureTrackVstInstrument(track.id, info)
    }
    setScanMsg(
      info.nombre.includes('Soft Pad')
        ? `«${info.nombre}» añadido · audible en Play / piano roll`
        : `«${info.nombre}» añadido · cargando audio en el Plugin Host…`,
    )
    openPluginEditor({
      trackId: track.id,
      pluginId: info.id,
      pluginName: info.nombre,
      zone: 'right',
    })
  }

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <Piano className="size-4 text-accent-amber" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          Instrumentos
        </span>
      </div>

      <div className="border-b border-border bg-accent-amber/10 px-3 py-2">
        {selectedTrackName ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-foreground">
              Añadir a pista: <span className="font-semibold">{selectedTrackName}</span>
            </p>
            <button
              type="button"
              onClick={() => void addToSelectedTrack('softpad')}
              className="inline-flex items-center justify-center gap-1 rounded-md bg-accent-amber/20 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
            >
              <Plus className="size-3" />
              Insertar Soft Pad
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Elige una pista en el arrangement (clic o icono piano) para asignar instrumentos.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="rounded-lg border border-border bg-panel-raised/50 p-3">
          <div className="mb-2 flex items-start gap-2">
            <Sparkles className="mt-0.5 size-4 text-accent-amber" />
            <div>
              <div className="text-[13px] font-semibold text-foreground">JasWave Soft Pad</div>
              <p className="text-[11px] text-muted-foreground">
                Instrumento interno (in-process). Ideal para piano roll / MIDI preview.
              </p>
            </div>
          </div>

          <label className="mb-3 flex items-center gap-2 text-[10px] text-muted-foreground">
            <Volume2 className="size-3" />
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

          <div className="relative mx-auto h-28 w-[256px] select-none">
            <div className="absolute inset-x-0 bottom-0 flex h-full">
              {WHITE.map((pitch) => (
                <button
                  key={pitch}
                  type="button"
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    down(pitch)
                  }}
                  onPointerUp={() => up(pitch)}
                  onPointerCancel={() => up(pitch)}
                  className={`relative flex-1 border border-border/80 bg-foreground/95 text-[9px] text-background ${
                    held === pitch ? 'bg-accent-amber' : ''
                  }`}
                >
                  <span className="absolute bottom-1 left-1/2 -translate-x-1/2">{noteLabel(pitch)}</span>
                </button>
              ))}
            </div>
            {BLACK.map(({ pitch, left }) => (
              <button
                key={pitch}
                type="button"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  down(pitch)
                }}
                onPointerUp={() => up(pitch)}
                onPointerCancel={() => up(pitch)}
                className={`absolute top-0 z-10 h-[60%] w-7 -translate-x-1/2 rounded-b bg-background text-[8px] text-muted-foreground ${
                  held === pitch ? 'ring-1 ring-accent-amber' : ''
                }`}
                style={{ left }}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() => requestOpenTool('piano-roll', { zone: 'bottom' })}
            className="mt-3 w-full rounded-md bg-accent-amber/15 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/25"
          >
            Abrir piano roll
          </button>
        </div>

        <div className="mt-3 rounded-lg border border-border bg-panel-raised/30 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-foreground">Carpetas de escaneo</div>
            <button
              type="button"
              onClick={() => void addFolder()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              <FolderPlus className="size-3" />
              Añadir carpeta
            </button>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            Al añadir una carpeta se escanea automáticamente.
          </p>

          <div className="mb-2 flex gap-1">
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addFolder(manualPath)
              }}
              placeholder="O pega una ruta…"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground"
            />
            <button
              type="button"
              disabled={!manualPath.trim()}
              onClick={() => void addFolder(manualPath)}
              className="rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
            >
              Añadir
            </button>
          </div>

          <div className="mb-3 max-h-36 overflow-y-auto rounded border border-border/60">
            {folders.length === 0 ? (
              <div className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                Sin carpetas
              </div>
            ) : (
              folders.map((f) => (
                <div
                  key={f.id}
                  className="flex items-start gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={(e) => {
                      setScanFolderEnabled(f.id, e.target.checked)
                      refreshFolders()
                    }}
                    className="mt-0.5"
                    title={f.enabled ? 'Incluir en escaneo' : 'Excluir del escaneo'}
                  />
                  <Folder className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] text-foreground" title={f.path}>
                      {f.path}
                    </div>
                    <div className="text-[9px] text-muted-foreground">
                      {f.kind === 'standard' ? 'estándar' : 'personalizada'}
                    </div>
                  </div>
                  {f.kind === 'custom' ? (
                    <button
                      type="button"
                      onClick={() => {
                        removeCustomScanFolder(f.id)
                        refreshFolders()
                      }}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive"
                      title="Quitar carpeta"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>

          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-foreground">
              Catálogo VST3 ({vstList.length})
            </div>
            <button
              type="button"
              disabled={scanning}
              onClick={() => void scanVst3()}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {scanning ? <Loader2 className="size-3 animate-spin" /> : <Search className="size-3" />}
              Escanear
            </button>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            {selectedTrackName
              ? `Pista activa: ${selectedTrackName}`
              : 'Haz clic en una pista del arrangement (o usa el icono de piano en la cabecera).'}
          </p>
          {scanMsg ? <p className="mb-2 text-[10px] text-accent-amber">{scanMsg}</p> : null}
          <div className="max-h-48 overflow-y-auto rounded border border-border/60">
            {vstList.length === 0 ? (
              <div className="px-2 py-3 text-center text-[10px] text-muted-foreground">
                Sin plugins en catálogo — añade carpetas y escanea
              </div>
            ) : (
              vstList.map((p) => (
                <div
                  key={p.pluginId}
                  className="flex items-start gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-foreground">{p.name}</div>
                    <div className="truncate text-[9px] text-muted-foreground">{p.path}</div>
                  </div>
                  <button
                    type="button"
                    title={
                      selectedTrackId
                        ? 'Añadir a la pista seleccionada'
                        : 'Selecciona una pista primero'
                    }
                    onClick={() => void addToSelectedTrack(p)}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="size-3" />
                    Pista
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
          Soft Pad es un instrumento interno: hay que insertarlo en la pista. No suena por
          defecto. Un VST insertado se carga en el Plugin Host; Play y el piano-roll le envían
          MIDI. La UI flotante es otra instancia (presets del editor no pasan al audio).
        </p>
      </div>
    </div>
  )
}

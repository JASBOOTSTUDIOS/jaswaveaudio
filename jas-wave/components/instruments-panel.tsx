import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  Piano,
  Volume2,
  Search,
  Loader2,
  FolderPlus,
  Trash2,
  Folder,
  Plus,
  Bot,
  BotOff,
  ChevronDown,
  ChevronRight,
  Star,
} from 'lucide-react'
import { audioEngine } from '@/lib/audio-engine'
import { requestOpenTool } from '@/src/workspace/types'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { DAWState } from '../../shared/src/types/state'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import {
  pluginManager,
  refreshPluginHostAvailability,
  catalogPluginInsertable,
  type PluginDescriptor,
} from '@/src/lib/plugin-host'
import {
  hydratePluginCatalog,
  promoteCachedVst3WhenHostReady,
} from '@/src/lib/plugin/catalog-store'
import { descriptorToPluginInfo, VST2_NOT_HOSTED_MSG } from '@/src/lib/plugin/plugin-info-adapter'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import {
  addCustomScanFolder,
  listScanFolders,
  removeCustomScanFolder,
  setScanFolderEnabled,
} from '@/src/lib/plugin/search-paths-store'
import type { PluginSearchPath } from '@/src/lib/plugin/search-paths'
import {
  applyJasWaveRolesParameter,
  findJasWaveRolesDescriptor,
  inferRoleFromTrack,
  jasWaveRolesPluginInfo,
} from '@/src/lib/plugin/jaswave-roles'
import { ensureTrackVstInstrument } from '@/src/lib/plugin/track-vst-runtime'
import { inferPluginRole, type InstrumentRole } from '@/src/lib/plugin-knowledge'
import {
  ASSIGNABLE_INSTRUMENT_ROLES,
  getInstrumentAiPrefsSnapshot,
  INSTRUMENT_ROLE_LABELS,
  isPluginAiEnabled,
  rolesWherePluginIsDefault,
  setPluginAiEnabled,
  setRoleDefault,
  subscribeInstrumentAiPrefs,
} from '@/src/lib/plugin/instrument-ai-prefs'
import { InstrumentConfigsPanel } from '@/components/instrument-configs-panel'

const WHITE = [60, 62, 64, 65, 67, 69, 71, 72]
const BLACK = [
  { pitch: 61, left: 28 },
  { pitch: 63, left: 60 },
  { pitch: 66, left: 124 },
  { pitch: 68, left: 156 },
  { pitch: 70, left: 188 },
]

type RoleFilter = 'all' | InstrumentRole | 'ai-off'

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

function useAiPrefs() {
  return useSyncExternalStore(
    subscribeInstrumentAiPrefs,
    getInstrumentAiPrefsSnapshot,
    getInstrumentAiPrefsSnapshot,
  )
}

/**
 * Panel de instrumentos: búsqueda, defaults por rol y activación para IA.
 */
export function InstrumentsPanel() {
  const tienda = useDAW()
  const prefs = useAiPrefs()
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
  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [showPreview, setShowPreview] = useState(false)
  const [showFolders, setShowFolders] = useState(false)
  const [panelTab, setPanelTab] = useState<'catalog' | 'configs'>('catalog')

  const refreshCatalogUi = useCallback(() => {
    hydratePluginCatalog()
    pluginManager.ensureBuiltins()
    setVstList(pluginManager.listAvailable().filter((p) => p.format === 'vst3' || p.format === 'vst2'))
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
          ? `${result.registered} plugins en catálogo (.vst3 y .dll VST2 x64 hosteables).`
          : result.error || 'No se encontraron .vst3 ni .dll en las carpetas habilitadas',
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

  const insertJasWaveRoles = async () => {
    if (!selectedTrackId) {
      setScanMsg('Selecciona una pista en el arrangement (icono piano en la cabecera).')
      return
    }
    const info = jasWaveRolesPluginInfo()
    if (!info) {
      setScanMsg('Roles.vst3 no está instalado / no aparece en el catálogo. Escanea carpetas VST3.')
      return
    }
    const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === selectedTrackId)
    if (!track) return
    await tienda.executor.execute('plugin.insert', {
      trackId: track.id,
      plugin: info,
    })
    try {
      await ensureTrackVstInstrument(track.id, info)
      await applyJasWaveRolesParameter(track.id, info, inferRoleFromTrack(track))
    } catch {
      /* host opcional */
    }
    setScanMsg(`«${info.nombre}» añadido · rol ${inferRoleFromTrack(track)} · cargando en Plugin Host…`)
    openPluginEditor({
      trackId: track.id,
      pluginId: info.id,
      pluginName: info.nombre,
      zone: 'right',
    })
    refreshCatalogUi()
  }

  const addToSelectedTrack = async (d: PluginDescriptor) => {
    if (!selectedTrackId) {
      setScanMsg('Selecciona una pista en el arrangement (icono piano en la cabecera).')
      return
    }
    let plugin = d
    if (!catalogPluginInsertable(plugin)) {
      if (plugin.format === 'vst3' && plugin.path) {
        const staleId = plugin.pluginId
        await refreshPluginHostAvailability()
        promoteCachedVst3WhenHostReady()
        const refreshed = pluginManager.listAvailable().find((p) => p.pluginId === staleId)
        if (refreshed && catalogPluginInsertable(refreshed)) plugin = refreshed
      }
    }
    if (!catalogPluginInsertable(plugin)) {
      setScanMsg(
        plugin.format === 'vst2' && !plugin.hostReady
          ? `«${plugin.name}»: ${VST2_NOT_HOSTED_MSG}`
          : `«${plugin.name}» no está listo para audio (host no disponible). Escanea de nuevo con el host en marcha.`,
      )
      return
    }
    const track = tienda.obtenerEstado().project?.tracks?.find((t) => t.id === selectedTrackId)
    if (!track) return
    const info = descriptorToPluginInfo(plugin)
    await tienda.executor.execute('plugin.insert', {
      trackId: track.id,
      plugin: info,
    })
    void ensureTrackVstInstrument(track.id, info)
    setScanMsg(`«${info.nombre}» añadido · cargando audio en el Plugin Host…`)
    openPluginEditor({
      trackId: track.id,
      pluginId: info.id,
      pluginName: info.nombre,
      zone: 'right',
    })
    refreshCatalogUi()
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vstList
      .map((p) => ({
        p,
        role: inferPluginRole(p.name, p.category),
        aiOn: isPluginAiEnabled(p.pluginId),
        defaultRoles: rolesWherePluginIsDefault(p.pluginId),
      }))
      .filter(({ p, role, aiOn }) => {
        if (roleFilter === 'ai-off' && aiOn) return false
        if (roleFilter !== 'all' && roleFilter !== 'ai-off' && role !== roleFilter) return false
        if (!q) return true
        const blob = `${p.name} ${p.vendor} ${p.path} ${p.category} ${INSTRUMENT_ROLE_LABELS[role]}`.toLowerCase()
        return blob.includes(q)
      })
      .sort((a, b) => {
        if (a.aiOn !== b.aiOn) return a.aiOn ? -1 : 1
        if (a.defaultRoles.length !== b.defaultRoles.length) {
          return b.defaultRoles.length - a.defaultRoles.length
        }
        return a.p.name.localeCompare(b.p.name)
      })
  }, [vstList, query, roleFilter, prefs])

  const roleChipCounts = useMemo(() => {
    const counts: Partial<Record<InstrumentRole, number>> = {}
    let aiOff = 0
    for (const p of vstList) {
      const role = inferPluginRole(p.name, p.category)
      counts[role] = (counts[role] ?? 0) + 1
      if (!isPluginAiEnabled(p.pluginId)) aiOff++
    }
    return { counts, aiOff }
  }, [vstList, prefs])

  const defaultSummary = useMemo(() => {
    return ASSIGNABLE_INSTRUMENT_ROLES.filter((r) => prefs.roleDefaults[r]).map((r) => {
      const ref = prefs.roleDefaults[r]!
      const sound = ref.presetNombre ? ` «${ref.presetNombre}»` : ''
      return `${INSTRUMENT_ROLE_LABELS[r]} → ${ref.pluginNombre}${sound}`
    })
  }, [prefs])

  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Piano className="size-4 text-accent-amber" />
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-foreground">
          Instrumentos
        </span>
        <span className="text-[10px] text-muted-foreground">{vstList.length}</span>
      </div>

      <div className="flex shrink-0 border-b border-border">
        <button
          type="button"
          onClick={() => setPanelTab('catalog')}
          className={`flex-1 px-3 py-1.5 text-[11px] ${
            panelTab === 'catalog'
              ? 'border-b-2 border-accent-amber font-semibold text-foreground'
              : 'text-muted-foreground'
          }`}
        >
          Catálogo VST
        </button>
        <button
          type="button"
          onClick={() => setPanelTab('configs')}
          className={`flex-1 px-3 py-1.5 text-[11px] ${
            panelTab === 'configs'
              ? 'border-b-2 border-accent-amber font-semibold text-foreground'
              : 'text-muted-foreground'
          }`}
        >
          Configs
        </button>
      </div>

      {panelTab === 'configs' ? (
        <div className="min-h-0 flex-1">
          <InstrumentConfigsPanel onMessage={setScanMsg} />
        </div>
      ) : (
      <>
      <div className="shrink-0 border-b border-border bg-accent-amber/10 px-3 py-2">
        {selectedTrackName ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-foreground">
              Añadir a pista: <span className="font-semibold">{selectedTrackName}</span>
            </p>
            {findJasWaveRolesDescriptor() ? (
              <button
                type="button"
                onClick={() => void insertJasWaveRoles()}
                className="inline-flex items-center justify-center gap-1 rounded-md bg-accent-amber/20 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
              >
                <Plus className="size-3" />
                Insertar JasWave Roles
              </button>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Roles.vst3 no está instalado / no aparece en el catálogo. Escanea carpetas VST3.
              </p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Elige una pista en el arrangement para asignar instrumentos.
          </p>
        )}
      </div>

      {/* Búsqueda sticky */}
      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex gap-1.5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, vendor, ruta, rol…"
              className="w-full rounded-md border border-border bg-background py-1.5 pl-7 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            disabled={scanning}
            onClick={() => void scanVst3()}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Escanear carpetas"
          >
            {scanning ? <Loader2 className="size-3 animate-spin" /> : <Folder className="size-3" />}
            Escanear
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          <FilterChip
            active={roleFilter === 'all'}
            label={`Todos (${vstList.length})`}
            onClick={() => setRoleFilter('all')}
          />
          {ASSIGNABLE_INSTRUMENT_ROLES.filter((r) => (roleChipCounts.counts[r] ?? 0) > 0).map((r) => (
            <FilterChip
              key={r}
              active={roleFilter === r}
              label={`${INSTRUMENT_ROLE_LABELS[r]} (${roleChipCounts.counts[r]})`}
              onClick={() => setRoleFilter(r)}
              starred={Boolean(prefs.roleDefaults[r])}
            />
          ))}
          {roleChipCounts.aiOff > 0 ? (
            <FilterChip
              active={roleFilter === 'ai-off'}
              label={`IA off (${roleChipCounts.aiOff})`}
              onClick={() => setRoleFilter('ai-off')}
            />
          ) : null}
        </div>

        {defaultSummary.length > 0 ? (
          <p className="truncate text-[10px] text-muted-foreground" title={defaultSummary.join(' · ')}>
            Defaults IA: {defaultSummary.join(' · ')}
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            Marca un instrumento como default de rol (★) para que la IA lo use al pedir batería, piano,
            etc. Desactiva (bot) los que no quieras que use.
          </p>
        )}

        {scanMsg ? <p className="text-[10px] text-accent-amber">{scanMsg}</p> : null}
      </div>

      {/* Lista principal — todo el espacio restante */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-8 text-center text-[11px] text-muted-foreground">
            {vstList.length === 0
              ? 'Sin plugins — abre Carpetas y escanea'
              : 'Ningún resultado con ese filtro'}
          </div>
        ) : (
          filtered.map(({ p, role, aiOn, defaultRoles }) => (
            <div
              key={p.pluginId}
              className={`flex items-start gap-2 border-b border-border/40 px-3 py-2 ${
                aiOn ? '' : 'opacity-55'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-foreground">{p.name}</span>
                  <span className="rounded bg-panel-raised px-1 py-px text-[9px] text-muted-foreground">
                    {p.format === 'vst2' ? 'VST2' : 'VST3'}
                  </span>
                  <span className="rounded bg-panel-raised px-1 py-px text-[9px] text-muted-foreground">
                    {INSTRUMENT_ROLE_LABELS[role]}
                  </span>
                  {defaultRoles.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-0.5 rounded bg-accent-amber/20 px-1 py-px text-[9px] text-accent-amber"
                    >
                      <Star className="size-2.5 fill-current" />
                      {INSTRUMENT_ROLE_LABELS[r]}
                    </span>
                  ))}
                </div>
                <div className="truncate text-[9px] text-muted-foreground" title={p.path}>
                  {!catalogPluginInsertable(p)
                    ? p.format === 'vst2'
                      ? 'Requiere host VST2 · '
                      : 'Host pendiente · '
                    : ''}
                  {p.vendor ? `${p.vendor} · ` : ''}
                  {p.path}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
                    Default rol
                    <select
                      className="max-w-[110px] rounded border border-border bg-background px-1 py-0.5 text-[10px] text-foreground"
                      value={defaultRoles[0] ?? ''}
                      onChange={(e) => {
                        const next = e.target.value as InstrumentRole | ''
                        if (!next) {
                          for (const r of defaultRoles) setRoleDefault(r, null)
                          setScanMsg(`Sin default de rol para «${p.name}»`)
                          return
                        }
                        setRoleDefault(next, { pluginId: p.pluginId, pluginNombre: p.name })
                        setScanMsg(`Default ${INSTRUMENT_ROLE_LABELS[next]} → ${p.name}`)
                      }}
                    >
                      <option value="">—</option>
                      {ASSIGNABLE_INSTRUMENT_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {INSTRUMENT_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <button
                  type="button"
                  title={
                    aiOn
                      ? 'Desactivar para la IA (sigue usable a mano)'
                      : 'Activar para que la IA pueda usarlo'
                  }
                  onClick={() => {
                    setPluginAiEnabled(p.pluginId, !aiOn)
                    setScanMsg(
                      aiOn
                        ? `«${p.name}» desactivado para la IA`
                        : `«${p.name}» activado para la IA`,
                    )
                  }}
                  className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[9px] ${
                    aiOn
                      ? 'border-border text-muted-foreground hover:text-foreground'
                      : 'border-destructive/40 text-destructive'
                  }`}
                >
                  {aiOn ? <Bot className="size-3" /> : <BotOff className="size-3" />}
                  {aiOn ? 'IA' : 'Off'}
                </button>
                <button
                  type="button"
                  title={
                    selectedTrackId
                      ? 'Añadir a la pista seleccionada'
                      : 'Selecciona una pista primero'
                  }
                  onClick={() => void addToSelectedTrack(p)}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3" />
                  Pista
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Secciones secundarias colapsables */}
      <div className="shrink-0 border-t border-border">
        <button
          type="button"
          onClick={() => setShowFolders((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-panel-raised/40 hover:text-foreground"
        >
          {showFolders ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Carpetas de escaneo ({folders.length})
        </button>
        {showFolders ? (
          <div className="max-h-40 space-y-2 overflow-y-auto border-t border-border/50 px-3 py-2">
            <div className="flex gap-1">
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addFolder(manualPath)
                }}
                placeholder="Ruta o «Añadir carpeta»…"
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => void addFolder()}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <FolderPlus className="size-3" />
                Carpeta
              </button>
            </div>
            {folders.map((f) => (
              <div key={f.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={(e) => {
                    setScanFolderEnabled(f.id, e.target.checked)
                    refreshFolders()
                  }}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1 truncate text-[10px] text-foreground" title={f.path}>
                  {f.path}
                </div>
                {f.kind === 'custom' ? (
                  <button
                    type="button"
                    onClick={() => {
                      removeCustomScanFolder(f.id)
                      refreshFolders()
                    }}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="flex w-full items-center gap-1.5 border-t border-border/50 px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-panel-raised/40 hover:text-foreground"
        >
          {showPreview ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Vista previa MIDI
        </button>
        {showPreview ? (
          <div className="space-y-2 border-t border-border/50 px-3 py-2">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
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
            <div className="relative mx-auto h-24 w-[256px] select-none">
              <div className="absolute inset-x-0 bottom-0 flex h-full">
                {WHITE.map((pitch) => (
                  <button
                    key={pitch}
                    type="button"
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId)
                      void down(pitch)
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
                    void down(pitch)
                  }}
                  onPointerUp={() => up(pitch)}
                  onPointerCancel={() => up(pitch)}
                  className={`absolute top-0 z-10 h-[60%] w-7 -translate-x-1/2 rounded-b bg-background ${
                    held === pitch ? 'ring-1 ring-accent-amber' : ''
                  }`}
                  style={{ left }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => requestOpenTool('piano-roll', { zone: 'bottom' })}
              className="w-full rounded-md bg-accent-amber/15 py-1.5 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/25"
            >
              Abrir piano roll
            </button>
          </div>
        ) : null}
      </div>
      </>
      )}
    </div>
  )
}

function FilterChip({
  active,
  label,
  onClick,
  starred,
}: {
  active: boolean
  label: string
  onClick: () => void
  starred?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] ${
        active
          ? 'bg-accent-amber/25 text-accent-amber'
          : 'bg-panel-raised text-muted-foreground hover:text-foreground'
      }`}
    >
      {starred ? <Star className="size-2.5 fill-current" /> : null}
      {label}
    </button>
  )
}

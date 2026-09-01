import { useEffect, useMemo, useState } from 'react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import type { Clip } from '../../shared/src/types/clips'
import type { DAWState } from '../../shared/src/types/state'
import type { PluginInfo } from '../../shared/src/types/entidades'
import {
  Volume2,
  VolumeX,
  Headphones,
  Circle,
  Trash2,
  Link2,
  Waves,
  Palette,
  SlidersHorizontal,
  Music2,
  Sparkles,
  Plus,
} from 'lucide-react'
import {
  linealADb,
  dbALineal,
  panADisplay,
} from '@/lib/audio-conversions'
import { FaderControl, KnobControl } from './ui/controls'
import { ConfirmDialog } from './ui/confirm-dialog'
import { requestOpenTool } from '@/src/workspace/types'
import { audioEngine } from '@/lib/audio-engine'
import { hydratePluginCatalog } from '@/src/lib/plugin/catalog-store'
import { pluginManager, catalogPluginInsertable } from '@/src/lib/plugin-host'
import { descriptorToPluginInfo } from '@/src/lib/plugin/plugin-info-adapter'
import { openPluginEditor } from '@/src/lib/plugin/plugin-editor-store'
import { openFxChain } from '@/src/lib/plugin/fx-chain-store'
import { TrackMidiInput } from '@/components/track-midi-input'
import { TrackAudioInput } from '@/components/track-audio-input'
import type { PluginDescriptor } from '@/src/lib/plugin/types'
import {
  isJasWaveRolesDescriptor,
  jasWaveRolesPluginInfo,
} from '@/src/lib/plugin/jaswave-roles'

const TRACK_COLORS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899',
  '#f43f5e', '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#2563eb', '#7c3aed',
  '#64748b', '#78716c', '#a1a1aa', '#f5f5f4', '#1c1917',
]

type InspectorTab = 'general' | 'audio' | 'apariencia' | 'plugins' | 'clip'

function TabButton({
  id,
  active,
  label,
  onClick,
}: {
  id: InspectorTab
  active: boolean
  label: string
  onClick: (id: InspectorTab) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

export function TrackDetailPanel({ trackId }: { trackId: string | null }) {
  const tienda = useDAW()
  const selection = useDAWState((s: DAWState) => s.selection)
  const track = useDAWState((s: DAWState) =>
    (s.project?.tracks ?? []).find((t) => t.id === trackId),
  )
  const selectedClip = useMemo(() => {
    const clipId = selection?.idsClips?.[0]
    if (!clipId || !track) return null
    return (track.clips ?? []).find((c) => c.id === clipId) ?? null
  }, [selection?.idsClips, track])

  const [tab, setTab] = useState<InspectorTab>('general')
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [catalog, setCatalog] = useState<PluginDescriptor[]>([])
  const [pickId, setPickId] = useState('')

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
  }, [tab])

  if (!trackId || !track) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel px-4 text-center">
        <SlidersHorizontal className="size-8 text-muted-foreground/40" />
        <p className="text-[12px] text-muted-foreground">
          Selecciona una pista, canal o clip para editar sus propiedades
        </p>
      </div>
    )
  }

  const linearVol = typeof track.volumen === 'number' ? track.volumen : 0.8
  const db = linealADb(linearVol)
  const pan = panADisplay(track.paneo ?? 0)
  const isAudio = track.tipo === 'audio'
  const isMidi = track.tipo === 'midi' || track.tipo === 'instrumento'
  const plugins = track.plugins ?? []

  const updateTrack = (datos: Record<string, unknown>) => {
    void tienda.executor.execute('track.update', { trackId: track.id, datos })
  }

  const updateClip = (patch: Partial<Clip>) => {
    const clips = (track.clips ?? []).map((c) =>
      c.id === selectedClip?.id ? ({ ...c, ...patch } as Clip) : c,
    )
    updateTrack({ clips })
  }

  const handleVolumeChange = (newDb: number) => {
    updateTrack({ volumen: dbALineal(newDb) })
  }

  const handlePanChange = (newPan: number) => {
    updateTrack({ paneo: newPan / 100 })
  }

  const tabs: { id: InspectorTab; label: string; show?: boolean }[] = [
    { id: 'general', label: 'General' },
    { id: 'audio', label: isMidi ? 'Canal' : 'Audio' },
    { id: 'apariencia', label: 'Apariencia' },
    { id: 'plugins', label: 'Plugins' },
    { id: 'clip', label: 'Clip', show: Boolean(selectedClip) },
  ]

  const activeTab = tab === 'clip' && !selectedClip ? 'general' : tab

  return (
    <div className="flex h-full flex-col bg-panel">
      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          void tienda.executor.execute('track.delete', { trackId: track.id })
          setConfirmDeleteOpen(false)
        }}
        title="Eliminar pista"
        message={`¿Eliminar la pista "${track.nombre}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        variant="danger"
      />

      {/* Header */}
      <div className="flex h-9 items-center gap-2 border-b border-border px-3">
        <div className="h-3 w-1 rounded-full" style={{ backgroundColor: track.color }} />
        <span className="truncate text-[12px] font-semibold text-foreground">{track.nombre}</span>
        <span className="rounded bg-panel-raised px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
          {track.tipo}
        </span>
        {selectedClip && (
          <span className="truncate rounded bg-accent-amber/15 px-1.5 py-0.5 text-[9px] text-accent-amber">
            clip: {selectedClip.nombre}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void tienda.executor.execute('track.toggleArm', { trackId: track.id })}
            aria-label="Armar"
            className={`flex size-5 items-center justify-center rounded ring-1 transition-colors ${
              track.armada
                ? 'bg-destructive text-background ring-destructive'
                : 'bg-panel-raised text-muted-foreground ring-border hover:text-destructive'
            }`}
          >
            <Circle className="size-2.5" fill={track.armada ? 'currentColor' : 'none'} />
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            aria-label="Eliminar pista"
            className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-panel-raised hover:text-destructive"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0.5 overflow-x-auto border-b border-border bg-panel-raised/50 px-2 py-1.5">
        {tabs
          .filter((t) => t.show !== false)
          .map((t) => (
            <TabButton
              key={t.id}
              id={t.id}
              active={activeTab === t.id}
              label={t.label}
              onClick={setTab}
            />
          ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {activeTab === 'general' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nombre
              </span>
              <input
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
                value={track.nombre}
                onChange={(e) => updateTrack({ nombre: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notas / comentario
              </span>
              <textarea
                className="min-h-[72px] resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
                value={track.notas ?? track.comentario ?? ''}
                onChange={(e) => updateTrack({ notas: e.target.value, comentario: e.target.value })}
                placeholder="Notas de la pista…"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Tags (separados por coma)
              </span>
              <input
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
                value={(track.tags ?? []).join(', ')}
                onChange={(e) =>
                  updateTrack({
                    tags: e.target.value
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </label>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <ToggleChip
                active={track.silenciada}
                label="Mute"
                icon={track.silenciada ? VolumeX : Volume2}
                onClick={() => void tienda.executor.execute('track.toggleMute', { trackId: track.id })}
                activeClass="bg-accent-amber/20 text-accent-amber"
              />
              <ToggleChip
                active={track.soloActiva}
                label="Solo"
                icon={Headphones}
                onClick={() => void tienda.executor.execute('track.toggleSolo', { trackId: track.id })}
                activeClass="bg-track-vocals/20 text-track-vocals"
              />
              <ToggleChip
                active={Boolean(track.frozen)}
                label={track.frozen ? 'Unfreeze' : 'Freeze'}
                icon={Waves}
                onClick={() => {
                  void (async () => {
                    const { freezeTrack, unfreezeTrack } = await import('@/src/lib/track-freeze')
                    if (track.frozen) await unfreezeTrack(tienda, track.id)
                    else await freezeTrack(tienda, track.id)
                  })()
                }}
                activeClass="bg-accent-amber/20 text-accent-amber"
              />
              {isMidi && (
                <button
                  type="button"
                  onClick={() => {
                    if (selectedClip?.tipo === 'midi') {
                      requestOpenTool('piano-roll', { zone: 'bottom' })
                    } else {
                      requestOpenTool('piano-roll', { zone: 'bottom' })
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-panel-raised px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <Music2 className="size-3" />
                  Abrir piano roll
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'audio' && (
          <div className="flex flex-wrap gap-6">
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Volumen
              </span>
              <FaderControl db={db} color={track.color} onChange={handleVolumeChange} />
            </div>
            <div className="flex flex-col items-center gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Paneo
              </span>
              <KnobControl
                value={pan}
                label="L/R"
                color={track.color}
                onChange={handlePanChange}
                min={-100}
                max={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                Monitor / entrada
              </span>
              {isAudio || isMidi ? (
                <button
                  type="button"
                  onClick={() => {
                    void tienda.executor.execute('track.toggleMonitor', { trackId: track.id })
                  }}
                  className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
                    track.configuracion?.monitorizarEntrada
                      ? 'bg-accent-cyan/20 text-accent-cyan'
                      : 'bg-panel-raised text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Headphones className="size-3" />
                  INPUT MONITOR
                </button>
              ) : null}
              {isMidi || isAudio ? (
                <div className="mt-1">
                  <TrackMidiInput trackId={track.id} assignedId={track.entrada} />
                </div>
              ) : null}
              {isAudio ? (
                <div className="mt-1">
                  <TrackAudioInput
                    trackId={track.id}
                    assignedId={
                      'dispositivoEntrada' in track && typeof track.dispositivoEntrada === 'string'
                        ? track.dispositivoEntrada
                        : track.entrada
                    }
                  />
                </div>
              ) : null}
              <div className="mt-2 flex items-center gap-1.5 rounded bg-panel-raised px-2.5 py-1.5 text-[10px] text-muted-foreground">
                <Link2 className="size-3" />
                Envíos: {(track.envios ?? []).length || 'ninguno'}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'apariencia' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Palette className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] font-semibold text-foreground">Color de pista</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TRACK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => updateTrack({ color: c })}
                  className={`size-5 rounded-full ring-1 transition-transform hover:scale-110 ${
                    track.color === c
                      ? 'ring-2 ring-foreground ring-offset-1 ring-offset-panel'
                      : 'ring-border'
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
              <input
                type="color"
                value={track.color.startsWith('#') ? track.color : '#6366f1'}
                onChange={(e) => updateTrack({ color: e.target.value })}
                className="size-5 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Color personalizado"
              />
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Icono (emoji o texto corto)
              </span>
              <input
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
                value={track.icono ?? ''}
                maxLength={4}
                onChange={(e) => updateTrack({ icono: e.target.value || undefined })}
                placeholder="🎹"
              />
            </label>
          </div>
        )}

        {activeTab === 'plugins' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-foreground">Cadena de plugins</span>
              <button
                type="button"
                onClick={() => openFxChain(track.id, 'right')}
                className="text-[10px] text-accent-amber hover:underline"
              >
                Abrir FX Chain
              </button>
            </div>

            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-panel-raised/40 p-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Añadir del catálogo
              </span>
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
                      {d.format === 'vst2'
                        ? d.hostReady
                          ? ''
                          : ' · no hosteable'
                        : !d.hostReady && d.format !== 'builtin'
                          ? ' · pendiente'
                          : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      const d = catalog.find((x) => x.pluginId === pickId)
                      if (d && !catalogPluginInsertable(d)) return
                      const rolesInfo =
                        d && isJasWaveRolesDescriptor(d) ? jasWaveRolesPluginInfo() : null
                      const info = rolesInfo ?? (d ? descriptorToPluginInfo(d) : null)
                      if (!info) return
                      await tienda.executor.execute('plugin.insert', {
                        trackId: track.id,
                        plugin: info,
                      })
                      openPluginEditor({
                        trackId: track.id,
                        pluginId: info.id,
                        pluginName: info.nombre,
                        zone: 'right',
                      })
                    })()
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-accent-amber/15 px-2 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/25"
                >
                  <Plus className="size-3" />
                  Añadir
                </button>
              </div>
              <p className="text-[9px] text-muted-foreground">
                JasWave Roles u otros VST del catálogo. VST3/VST2 x64: MIDI al Plugin Host cuando
                el load confirma.
              </p>
            </div>

            {plugins.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center">
                <Waves className="size-7 text-muted-foreground/40" />
                <p className="text-[11px] text-muted-foreground">
                  Sin plugins en esta pista. Elige uno del catálogo arriba.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {plugins.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-start gap-2 rounded-md border border-border bg-panel-raised/60 px-2.5 py-2"
                  >
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-accent-amber" />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() =>
                        openPluginEditor({
                          trackId: track.id,
                          pluginId: p.id,
                          pluginName: p.nombre,
                          zone: 'right',
                        })
                      }
                      title="Abrir UI del plugin"
                    >
                      <div className="truncate text-[12px] font-semibold text-foreground hover:text-accent-amber">
                        {p.nombre}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {p.fabricante} · {p.tipo} · {p.estado}
                        {p.bypass ? ' · bypass' : ''}
                      </div>
                      {p.descripcion ? (
                        <div
                          className="mt-0.5 truncate text-[9px] text-muted-foreground/80"
                          title={p.descripcion}
                        >
                          {p.descripcion}
                        </div>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      title="Quitar"
                      onClick={() => {
                        void tienda.executor.execute('plugin.remove', {
                          trackId: track.id,
                          pluginInstanceId: p.id,
                        })
                        audioEngine.allNotesOff()
                      }}
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'clip' && selectedClip && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nombre del clip
              </span>
              <input
                className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] text-foreground outline-none focus:ring-1 focus:ring-accent-amber"
                value={selectedClip.nombre}
                onChange={(e) => updateClip({ nombre: e.target.value })}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Inicio (beats)
                </span>
                <input
                  type="number"
                  step={0.25}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent-amber"
                  value={selectedClip.inicio}
                  onChange={(e) =>
                    void tienda.executor.execute('clip.move', {
                      clipId: selectedClip.id,
                      pistaId: track.id,
                      inicio: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Duración
                </span>
                <input
                  type="number"
                  step={0.25}
                  min={0.25}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-[12px] outline-none focus:ring-1 focus:ring-accent-amber"
                  value={selectedClip.duracion}
                  onChange={(e) =>
                    void tienda.executor.execute('clip.resize', {
                      clipId: selectedClip.id,
                      pistaId: track.id,
                      duracion: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Palette className="size-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground">Color del clip</span>
              <input
                type="color"
                value={selectedClip.color?.startsWith('#') ? selectedClip.color : track.color}
                onChange={(e) => updateClip({ color: e.target.value })}
                className="ml-auto size-6 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
            <div className="rounded-md bg-panel-raised px-2.5 py-2 text-[11px] text-muted-foreground">
              Tipo: <span className="text-foreground">{selectedClip.tipo}</span>
              {selectedClip.tipo === 'midi' && (
                <>
                  {' · '}
                  {(selectedClip as { notas?: unknown[] }).notas?.length ?? 0} notas
                </>
              )}
            </div>
            {selectedClip.tipo === 'midi' && (
              <div className="flex flex-wrap gap-6 rounded-md border border-border px-3 py-3">
                <p className="w-full text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Canal de la pista
                </p>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Volumen
                  </span>
                  <FaderControl db={db} color={track.color} onChange={handleVolumeChange} />
                </div>
                <div className="flex flex-col items-center gap-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Paneo
                  </span>
                  <KnobControl
                    value={pan}
                    label="L/R"
                    color={track.color}
                    onChange={handlePanChange}
                    min={-100}
                    max={100}
                  />
                </div>
                <div className="flex flex-wrap gap-1.5 self-end">
                  <ToggleChip
                    active={track.silenciada}
                    label="Mute"
                    icon={track.silenciada ? VolumeX : Volume2}
                    onClick={() => void tienda.executor.execute('track.toggleMute', { trackId: track.id })}
                    activeClass="bg-accent-amber/20 text-accent-amber"
                  />
                  <ToggleChip
                    active={track.soloActiva}
                    label="Solo"
                    icon={Headphones}
                    onClick={() => void tienda.executor.execute('track.toggleSolo', { trackId: track.id })}
                    activeClass="bg-track-vocals/20 text-track-vocals"
                  />
                </div>
              </div>
            )}
            {selectedClip.tipo === 'midi' && (
              <button
                type="button"
                onClick={() => requestOpenTool('piano-roll', { zone: 'bottom' })}
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-accent-amber/20 px-3 py-2 text-[11px] font-semibold text-accent-amber hover:bg-accent-amber/30"
              >
                <Music2 className="size-3.5" />
                Editar en piano roll
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleChip({
  active,
  label,
  icon: Icon,
  onClick,
  activeClass,
}: {
  active: boolean
  label: string
  icon: typeof Volume2
  onClick: () => void
  activeClass: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[10px] font-semibold transition-colors ${
        active ? activeClass : 'bg-panel-raised text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="size-3" />
      {label}
    </button>
  )
}

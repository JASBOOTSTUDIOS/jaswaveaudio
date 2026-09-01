import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Drum,
  Guitar,
  KeyboardMusic,
  Layers,
  Loader2,
  Music2,
  Piano,
  Sparkles,
} from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import { executeDawActions } from '@/src/lib/ai-daw-agent'
import { expandSectionsToBarPlan } from '@/src/lib/music-build'
import {
  composeMidiFromBrief,
  hashSeed,
  parseMidiBriefFromText,
  type Articulation,
  type GeneratedNote,
} from '@/src/lib/midi-song-generator'
import { pluginRegistry } from '@/src/lib/plugin/registry'
import { MidiPreviewTransport } from '@/components/midi-preview-transport'
import { stopMidiPreviewAudition } from '@/src/lib/midi-preview-audition'
import { patchMessage } from '@/src/lib/ai-chat-store'
import type {
  MusicBuildResult,
  MusicBuildStage,
  MusicBuildStageStatus,
  MusicBuildTrackSpec,
} from '@/src/lib/music-build/types'

type Props = {
  build: MusicBuildResult
  status?: 'pending' | 'applied' | 'discarded'
  conversationId?: string
  messageId?: string
  onApplied?: () => void
}

type TrackDraft = MusicBuildTrackSpec & { previewNotes: GeneratedNote[] }

const ROLE_LABEL: Record<string, string> = {
  drums: 'Batería',
  bass: 'Bajo',
  keys: 'Teclas',
  piano: 'Piano',
  pad: 'Pads',
  lead: 'Melodía',
  guitar: 'Guitarra',
  vocal: 'Voz',
  fx: 'FX',
}

function roleLabel(rol: string): string {
  return ROLE_LABEL[rol.toLowerCase()] ?? rol
}

function RoleIcon({ rol }: { rol: string }) {
  const r = rol.toLowerCase()
  const cls = 'size-3.5 shrink-0 text-muted-foreground'
  if (r === 'drums') return <Drum className={cls} />
  if (r === 'bass' || r === 'guitar') return <Guitar className={cls} />
  if (r === 'piano' || r === 'keys') return <Piano className={cls} />
  if (r === 'pad') return <KeyboardMusic className={cls} />
  return <Music2 className={cls} />
}

function stageTone(status: MusicBuildStageStatus): string {
  if (status === 'ok') return 'bg-emerald-500'
  if (status === 'fail') return 'bg-rose-500'
  if (status === 'running') return 'bg-accent-amber animate-pulse'
  if (status === 'skip') return 'bg-muted-foreground/30'
  return 'bg-muted-foreground/25'
}

function friendlyStageLabel(s: MusicBuildStage): string {
  const map: Record<string, string> = {
    'Tempo y métrica': 'Tempo',
    Tempo: 'Tempo',
    'Estructura (marcadores)': 'Estructura',
    Estructura: 'Estructura',
    Pistas: 'Pistas',
    'Instrumentos (catálogo)': 'Sonidos',
    Instrumentos: 'Sonidos',
    'MIDI validado': 'Partituras',
    MIDI: 'Partituras',
    'Mezcla de producción': 'Mezcla',
    Mezcla: 'Mezcla',
    Validación: 'Revisión',
  }
  for (const [k, v] of Object.entries(map)) {
    if (s.label.startsWith(k) || s.label === k) return v
  }
  return s.label.replace(/\s*\(.*\)\s*$/, '').trim() || s.label
}

function artForRole(rol: string, explicit?: string): Articulation {
  if (explicit === 'arp' || explicit === 'strum' || explicit === 'pad' || explicit === 'block' || explicit === 'drums' || explicit === 'bass') {
    return explicit
  }
  const r = rol.toLowerCase()
  if (r === 'drums') return 'drums'
  if (r === 'bass') return 'bass'
  if (r === 'pad') return 'pad'
  if (r === 'guitar') return 'strum'
  if (r === 'lead') return 'arp'
  return 'block'
}

function buildTrackPreview(
  spec: MusicBuildResult['spec'],
  track: MusicBuildTrackSpec,
): GeneratedNote[] {
  const previewBars = Math.min(
    8,
    Math.max(4, spec.sections.slice(0, 2).reduce((n, s) => n + s.bars, 0) || 8),
  )
  let barPlan = expandSectionsToBarPlan(spec.sections, spec.degrees)
  if (barPlan.length > previewBars) barPlan = barPlan.slice(0, previewBars)
  const art = artForRole(String(track.rol), track.articulacion ? String(track.articulacion) : undefined)
  const brief = parseMidiBriefFromText(
    `${spec.prompt} ${spec.genero ?? ''} ${track.rol} ${track.nombre}`,
    spec.bpm,
  )
  brief.articulation = art
  brief.minutes = Math.max(0.25, (previewBars * 4) / Math.max(1, spec.bpm))
  brief.keyRoot = spec.keyRoot
  brief.scale = spec.scale
  brief.keyLabel = spec.keyLabel
  brief.degrees = spec.degrees.length ? spec.degrees : brief.degrees
  const song = composeMidiFromBrief(brief, {
    bpm: spec.bpm,
    seed: hashSeed(`${spec.nombre}|${track.nombre}|${art}|preview`),
    barPlan,
    aiDirected: true,
  })
  return song.notes
}

/** Vista limpia del Music Build + preview MIDI + cambio de instrumento. */
export function MusicBuildPreview({ build, status = 'pending', conversationId, messageId, onApplied }: Props) {
  const tienda = useDAW()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(build.applied ? 'applied' : status)
  const [activeIdx, setActiveIdx] = useState(0)
  const spec = build.spec
  const planned = local !== 'applied'

  useEffect(() => {
    if (build.applied) setLocal('applied')
  }, [build.applied])

  const instruments = useMemo(() => {
    try {
      const list = pluginRegistry.findInstruments()
      const ready = list.filter((d) => d.hostReady || d.scanStatus === 'ok' || d.format === 'builtin')
      return (ready.length ? ready : list).slice(0, 120)
    } catch {
      return []
    }
  }, [])

  const [tracks, setTracks] = useState<TrackDraft[]>(() =>
    spec.tracks.map((t) => ({
      ...t,
      previewNotes: buildTrackPreview(spec, t),
    })),
  )

  useEffect(() => {
    setTracks(
      spec.tracks.map((t) => ({
        ...t,
        previewNotes: buildTrackPreview(spec, t),
      })),
    )
    setActiveIdx(0)
  }, [spec])

  const active = tracks[activeIdx] ?? tracks[0]

  const stopPreview = useCallback(() => {
    stopMidiPreviewAudition()
  }, [])

  useEffect(() => () => stopMidiPreviewAudition(), [])

  const setInstrument = useCallback((index: number, pluginId: string) => {
    setTracks((prev) =>
      prev.map((t, i) => {
        if (i !== index) return t
        if (!pluginId) {
          return { ...t, pluginId: undefined, pluginNombre: undefined }
        }
        const d = instruments.find((x) => x.pluginId === pluginId)
        return {
          ...t,
          pluginId,
          pluginNombre: d?.name ?? t.pluginNombre,
        }
      }),
    )
  }, [instruments])

  const apply = useCallback(async () => {
    setBusy(true)
    stopPreview()
    try {
      const pistas = tracks.map((t) => ({
        nombre: t.nombre,
        rol: t.rol,
        tipo: t.tipo,
        articulacion: t.articulacion,
        pluginId: t.pluginId,
        pluginNombre: t.pluginNombre,
      }))
      const results = await executeDawActions(
        tienda,
        [
          {
            type: 'daw.musicBuild',
            payload: {
              aplicar: true,
              prompt: spec.prompt,
              nombre: spec.nombre,
              bpm: spec.bpm,
              minutos: spec.minutes,
              genero: spec.genero,
              midiSource: 'procedural',
              pistas,
              tracks: pistas,
              secciones: spec.sections,
              sections: spec.sections,
              degrees: spec.degrees,
              keyLabel: spec.keyLabel,
              keyRoot: spec.keyRoot,
              scale: spec.scale,
            },
          },
        ],
        { agentMode: 'create', forceApply: true, source: 'user_confirm', respectModeGate: false },
      )
      if (results.some((r) => r.success)) {
        setLocal('applied')
        if (conversationId && messageId) {
          patchMessage(conversationId, messageId, {
            musicBuild: { ...build, applied: true, status: 'completed' },
          })
          onApplied?.()
        }
      }
    } finally {
      setBusy(false)
    }
  }, [build, conversationId, messageId, onApplied, spec, stopPreview, tienda, tracks])

  const stagesVisible = useMemo(() => {
    if (planned) {
      return build.stages.filter((s) =>
        /tempo|estruct|pista|instrument|midi|mezcla|valid/i.test(s.label),
      )
    }
    return build.stages
  }, [build.stages, planned])

  const previewDur = useMemo(() => {
    const notes = active?.previewNotes ?? []
    if (!notes.length) return 8
    return Math.max(4, ...notes.map((n) => n.inicio + n.duracion))
  }, [active])

  const genre = spec.genero ? String(spec.genero) : null

  const candidateTrackIds = useMemo(
    () => tienda.obtenerEstado().project.tracks.map((t) => t.id),
    [tienda],
  )

  const projectTrackId = useMemo(() => {
    if (!active) return null
    const projectTracks = tienda.obtenerEstado().project.tracks
    const byName = projectTracks.find(
      (t) => t.nombre.trim().toLowerCase() === String(active.nombre).trim().toLowerCase(),
    )
    if (byName) return byName.id
    const rol = String(active.rol).toLowerCase()
    const byRole = projectTracks.find((t) => {
      const n = t.nombre.toLowerCase()
      if (rol === 'drums' && /bater|drum/.test(n)) return true
      if (rol === 'bass' && /bajo|bass/.test(n)) return true
      if ((rol === 'keys' || rol === 'piano') && /key|piano|tecla/.test(n)) return true
      if (rol === 'pad' && /pad/.test(n)) return true
      if (rol === 'lead' && /lead|melod/.test(n)) return true
      return false
    })
    return byRole?.id ?? null
  }, [active, tienda])

  const projectTrackPlugins = useMemo(() => {
    if (!projectTrackId) return null
    return (
      tienda.obtenerEstado().project.tracks.find((t) => t.id === projectTrackId)?.plugins ?? null
    )
  }, [projectTrackId, tienda])

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-border/80 bg-card/40 shadow-sm">
      <div className="flex items-start justify-between gap-3 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent-amber/15 text-accent-amber">
              <Layers className="size-3.5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-[13px] font-semibold tracking-tight text-foreground">
                {spec.nombre}
              </h3>
              <p className="text-[11px] text-muted-foreground">
                {genre ? `${genre.charAt(0).toUpperCase()}${genre.slice(1)} · ` : ''}
                {spec.keyLabel} · {spec.bpm} BPM · ~{spec.minutes} min
              </p>
            </div>
          </div>
        </div>
        {planned ? (
          <span className="shrink-0 rounded-full bg-accent-amber/15 px-2 py-0.5 text-[10px] font-medium text-accent-amber">
            Listo para crear
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
            <Check className="size-3" /> Creado
          </span>
        )}
      </div>

      {planned ? (
        <p className="px-3.5 pb-2 text-[12px] leading-snug text-muted-foreground">
          Elige instrumento por pista, escucha el borrador MIDI y crea el tema en el proyecto.
        </p>
      ) : null}

      <div className="px-3.5 pb-3">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Forma
        </div>
        <div className="flex flex-wrap gap-1.5">
          {spec.sections.map((s, i) => (
            <span
              key={`${s.name}-${i}`}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background/50 px-2 py-1 text-[11px] text-foreground"
            >
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">{s.bars} compases</span>
            </span>
          ))}
        </div>
      </div>

      {/* Pistas + instrumento */}
      <div className="border-t border-border/50 px-3.5 py-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          Pistas ({tracks.length})
        </div>
        <ul className="space-y-2">
          {tracks.map((t, i) => {
            const selected = i === activeIdx
            return (
              <li
                key={`${t.nombre}-${i}`}
                className={`rounded-lg border px-2.5 py-2 transition-colors ${
                  selected
                    ? 'border-accent-amber/50 bg-accent-amber/5'
                    : 'border-border/40 bg-background/30'
                }`}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 text-left"
                  onClick={() => {
                    setActiveIdx(i)
                    stopPreview()
                  }}
                >
                  <RoleIcon rol={String(t.rol)} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium text-foreground">{t.nombre}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {roleLabel(String(t.rol))} · {t.previewNotes.length} notas (borrador)
                    </div>
                  </div>
                </button>
                {planned ? (
                  <label className="mt-1.5 flex flex-col gap-0.5">
                    <span className="text-[10px] text-muted-foreground">Instrumento</span>
                    <select
                      className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground"
                      value={t.pluginId ?? ''}
                      onChange={(e) => setInstrument(i, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <option value="">
                        {t.pluginNombre ? `${t.pluginNombre} (sugerido)` : 'Elegir al crear…'}
                      </option>
                      {instruments.map((d) => (
                        <option key={d.pluginId} value={d.pluginId}>
                          {d.name}
                          {d.vendor ? ` — ${d.vendor}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">
                    {t.pluginNombre ?? 'Instrumento del proyecto'}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* Timeline + transporto de la pista activa */}
      {active ? (
        <div className="border-t border-border/50 px-3.5 py-3">
          <div className="mb-2 min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
              Vista previa MIDI
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {active.nombre} · clic en la línea de tiempo para oír desde ahí
            </div>
          </div>
          <MidiPreviewTransport
            notes={active.previewNotes}
            bpm={spec.bpm}
            durationBeats={previewDur}
            pluginId={active.pluginId}
            pluginNombre={active.pluginNombre}
            rol={String(active.rol)}
            trackId={projectTrackId}
            trackNombre={active.nombre}
            trackPlugins={projectTrackPlugins}
            candidateTrackIds={candidateTrackIds}
          />
        </div>
      ) : null}

      <div className="border-t border-border/50 px-3.5 py-3">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/80">
          {planned ? 'Al crear' : 'Progreso'}
        </div>
        <ol className="flex flex-wrap gap-2">
          {stagesVisible.map((s) => (
            <li
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              <span className={`size-1.5 rounded-full ${stageTone(s.status)}`} />
              {friendlyStageLabel(s)}
            </li>
          ))}
        </ol>
      </div>

      {planned ? (
        <div className="border-t border-border/60 bg-accent-amber/5 px-3.5 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void apply()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent-amber px-3 py-2 text-[12px] font-semibold text-background hover:bg-accent-amber/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Crear en el proyecto
          </button>
        </div>
      ) : (
        <div className="border-t border-border/60 bg-emerald-950/20 px-3.5 py-3 text-center text-[11px] text-emerald-300/90">
          <Check className="mb-1 inline size-3.5" /> Ya aplicado en el proyecto
        </div>
      )}
    </div>
  )
}

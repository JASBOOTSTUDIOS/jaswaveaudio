import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, LayoutGrid, Mic2, MoreVertical, Circle, Music, Upload, FileAudio } from 'lucide-react'
import { usePlayback } from '@/components/playback-provider'
import { createProjection, type TimelineProjection } from '@/lib/timeline-projection'
import { TRACKS, type Track as UiTrack } from '@/lib/daw-data'
import { useDAW, useDAWState } from '../src/context/daw-context'
import type { DAWState } from '../../shared/src'
import { linealADb, panADisplay, msATiempoFormateado, beatsASegundos, msACompasBeat } from '@/lib/audio-conversions'
import { ConfirmDialog } from './ui/confirm-dialog'
import { StereoWaveform } from './stereo-waveform'
import { requestOpenTool } from '@/src/workspace/types'

type UiLikeTrack = UiTrack & { muted?: boolean; solo?: boolean; input?: boolean; armed?: boolean }

function toUiLikeTrack(track: unknown): UiLikeTrack {
  const anyTrack = track as Record<string, unknown>
  const ui = TRACKS.find((t) => t.id === String(anyTrack.id ?? ''))
  return {
    id: String(anyTrack.id ?? ''),
    name: ui?.name ?? String(anyTrack.nombre ?? ''),
    color: ui?.color ?? String(anyTrack.color ?? '#888'),
    seed: ui?.seed ?? 0,
    db: typeof anyTrack.volumen === 'number' ? linealADb(anyTrack.volumen) : ui?.db ?? 0,
    pan: typeof anyTrack.paneo === 'number' ? panADisplay(anyTrack.paneo) : ui?.pan ?? 0,
    muted: Boolean(anyTrack.silenciada),
    solo: Boolean(anyTrack.soloActiva),
    input: Boolean(anyTrack.entrada),
    armed: Boolean(anyTrack.armada),
  }
}

const ROW_H = 72
const MIN_TOTAL_BEATS = 640
// Zoom inicial: 5px por beat para que los clips sean visibles de entrada
const BASE_PIXELS_PER_BEAT = 5
/** Overview → muestra a muestra (estilo Reaper) */
export const ARRANGE_MIN_ZOOM = 0.15
export const ARRANGE_MAX_ZOOM = 256

type TrackToggle = { muted: boolean; solo: boolean; input: boolean; armed: boolean }

function TrackButton({
  children,
  active,
  activeClass = 'bg-accent-amber text-background',
  onClick,
  label,
}: {
  children: React.ReactNode
  active?: boolean
  activeClass?: string
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex size-5 items-center justify-center rounded text-[10px] font-bold transition-colors ${
        active
          ? activeClass
          : 'bg-panel-raised text-muted-foreground ring-1 ring-border hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// Componente de Regla Dinámica — alineado exactamente con los clips en píxeles
function TimeRuler({
  projection,
  zoom,
  totalHeight,
  bpm,
  beatsPerBar,
}: {
  projection: TimelineProjection
  zoom: number
  totalHeight: number
  bpm: number
  beatsPerBar: number
}) {
  const pxPerBeat = BASE_PIXELS_PER_BEAT * zoom
  const pxPerBar = pxPerBeat * beatsPerBar
  const { start: startBeat, end: endBeat } = projection.visibleBeatRange()

  // Densidad de etiquetas de compás (estilo Reaper: más espacio → más números)
  const minBarSpacingPx = 36
  const barInterval = pxPerBar < minBarSpacingPx
    ? Math.max(1, Math.ceil(minBarSpacingPx / pxPerBar))
    : 1

  const firstBar = Math.max(1, Math.floor(startBeat / beatsPerBar) - 1)
  const lastBar = Math.ceil(endBeat / beatsPerBar) + 2

  const marks: { bar: number; beat: number; label: string; minor: boolean }[] = []
  for (let bar = firstBar; bar <= lastBar; bar++) {
    const beatPos = (bar - 1) * beatsPerBar
    const showLabel = (bar - 1) % barInterval === 0

    marks.push({
      bar,
      beat: beatPos,
      label: showLabel ? `${bar}` : '',
      minor: !showLabel,
    })

    if (pxPerBeat > 14) {
      for (let b = 1; b < beatsPerBar; b++) {
        const showBeatLabel = pxPerBeat > 40
        marks.push({
          bar,
          beat: beatPos + b,
          label: showBeatLabel ? `${bar}.${b + 1}` : '',
          minor: true,
        })
      }
    }
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {marks.map((m, i) => (
        <div
          key={`${m.beat}-${i}`}
          className={`absolute top-0 bottom-0 ${
            m.minor ? 'border-l border-grid-line/30' : 'border-l border-grid-line/70'
          }`}
          style={{ left: projection.beatToPixel(m.beat) }}
        >
          {m.label && (
            <span className="absolute left-1 top-0.5 select-none font-mono text-[10px] font-medium text-muted-foreground">
              {m.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

function GridLines({ projection, zoom, beatsPerBar }: { projection: TimelineProjection; zoom: number; beatsPerBar: number }) {
  const pxPerBeat = BASE_PIXELS_PER_BEAT * zoom

  const levels = useMemo(() => {
    const levels: { beat: number; minPx: number; className: string }[] = []

    if (pxPerBeat >= 80) {
      levels.push({ beat: 1 / 32, minPx: 4, className: 'bg-grid-line/40' })
      levels.push({ beat: 1 / 16, minPx: 6, className: 'bg-grid-line/60' })
      levels.push({ beat: 1 / 8, minPx: 10, className: 'bg-grid-line/80' })
      levels.push({ beat: 1 / 4, minPx: 16, className: 'bg-border' })
      levels.push({ beat: 1 / 2, minPx: 24, className: 'bg-border' })
      levels.push({ beat: 1, minPx: 40, className: 'bg-border' })
    } else if (pxPerBeat >= 30) {
      levels.push({ beat: 1 / 16, minPx: 4, className: 'bg-grid-line/40' })
      levels.push({ beat: 1 / 8, minPx: 6, className: 'bg-grid-line/60' })
      levels.push({ beat: 1 / 4, minPx: 10, className: 'bg-grid-line/80' })
      levels.push({ beat: 1 / 2, minPx: 16, className: 'bg-border' })
      levels.push({ beat: 1, minPx: 30, className: 'bg-border' })
    } else if (pxPerBeat >= 12) {
      levels.push({ beat: 1 / 8, minPx: 4, className: 'bg-grid-line/40' })
      levels.push({ beat: 1 / 4, minPx: 6, className: 'bg-grid-line/60' })
      levels.push({ beat: 1 / 2, minPx: 12, className: 'bg-border' })
      levels.push({ beat: 1, minPx: 20, className: 'bg-border' })
    } else if (pxPerBeat >= 5) {
      levels.push({ beat: 1 / 4, minPx: 4, className: 'bg-grid-line/40' })
      levels.push({ beat: 1 / 2, minPx: 8, className: 'bg-grid-line/60' })
      levels.push({ beat: 1, minPx: 14, className: 'bg-border' })
    } else {
      levels.push({ beat: 1, minPx: 10, className: 'bg-border' })
      if (pxPerBeat >= 2) {
        levels.push({ beat: 4, minPx: 40, className: 'bg-border' })
      }
    }

    return levels
  }, [pxPerBeat])

  const lines = useMemo(() => {
    const result: { left: number; className: string; label?: string }[] = []
    const { start: startBeat, end: endBeat } = projection.visibleBeatRange()
    const pad = beatsPerBar * 2
    const from = Math.max(0, startBeat - pad)
    const to = endBeat + pad

    for (const level of levels) {
      const firstBeat = Math.floor(from / level.beat) * level.beat
      const pxPerSub = level.beat * pxPerBeat
      if (pxPerSub < level.minPx) continue

      for (let beat = firstBeat; beat <= to; beat += level.beat) {
        if (beat < 0) continue
        const px = projection.beatToPixel(beat)

        // Solo etiquetar inicios de compás (no cada beat)
        const isBarStart = Math.abs(beat % beatsPerBar) < 1e-9
        const label =
          level.beat >= beatsPerBar && isBarStart
            ? `${Math.floor(beat / beatsPerBar) + 1}`
            : undefined

        result.push({
          left: px,
          className: isBarStart ? 'bg-border' : level.className,
          label,
        })
      }
    }

    return result
  }, [levels, projection, pxPerBeat, beatsPerBar])

  return (
    <div className="pointer-events-none absolute inset-0">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`absolute inset-y-0 ${line.className}`}
          style={{ left: line.left, width: line.label ? 'auto' : '1px' }}
        >
          {line.label && (
            <span className="absolute top-0.5 -translate-x-1/2 font-mono text-[9px] text-muted-foreground">
              {line.label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

type DragMode = 'move' | 'trim-left' | 'trim-right'

interface ClipDragState {
  mode: DragMode
  clipId: string
  trackId: string
  startMouseX: number
  startMouseY: number
  initialInicio: number
  initialDuracion: number
  previewInicio: number
  previewDuracion: number
  previewTrackId: string
}

const HEADER_H = 40 // alineado con regla de tiempo

export function ArrangeView() {
  const tienda = useDAW()
  const sharedTracks = useDAWState((state: DAWState) => state.project?.tracks || [])
  const activeTool = useDAWState((state: DAWState) => state.ui?.herramientaActiva || 'select')
  const snapValor = useDAWState((state: DAWState) => state.project?.timeline?.snapValor ?? 1)
  const snapEnabled = useDAWState((state: DAWState) => state.project?.timeline?.snap ?? true)
  const bpm = useDAWState((state: DAWState) => state.project?.bpm?.valor ?? 120)
  const beatsPerBar = useDAWState((state: DAWState) => state.project?.timeSignature?.numerador ?? 4)
  const loopState = useDAWState((state: DAWState) => state.transport?.loop)
  const zoom = useDAWState((state: DAWState) => state.ui?.zoomHorizontal ?? 1)
  const scrollLeft = useDAWState((state: DAWState) => state.ui?.scrollX ?? 0)
  const selectedClipId = useDAWState((state: DAWState) => state.selection?.idsClips?.[0] ?? null)
  const loopActivo = Boolean(loopState?.activo)
  const loopInicioBeats = loopState?.inicio?.beats ?? 0
  const loopFinBeats = loopState?.fin?.beats ?? 0

  const { seekToBeats, clips, addClipFromFile } = usePlayback()
  const transportSeconds = useDAWState((s: DAWState) => s.transport?.posicion?.segundos ?? 0)
  const timelineRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const headersScrollRef = useRef<HTMLDivElement>(null)
  const lanesScrollRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)
  const lastPointerXRef = useRef<number | null>(null)

  const [dragging, setDragging] = useState(false)
  const [playheadTooltip, setPlayheadTooltip] = useState<{ beat: number; bar: number; beatInBar: number } | null>(null)
  const [trackAreaHeight, setTrackAreaHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(800)

  const [clipDrag, setClipDrag] = useState<ClipDragState | null>(null)
  const [showAddTrackMenu, setShowAddTrackMenu] = useState(false)
  const addTrackMenuRef = useRef<HTMLDivElement>(null)
  const addTrackFileRef = useRef<HTMLInputElement>(null)
  const [importTargetTrack, setImportTargetTrack] = useState<string | null>(null)
  const [deleteConfirmTrack, setDeleteConfirmTrack] = useState<string | null>(null)

  const tracks: UiLikeTrack[] = useMemo(() => {
    return sharedTracks.map((raw: unknown) => toUiLikeTrack(raw))
  }, [sharedTracks])

  const TOTAL_BEATS = useMemo(() => {
    let maxBeat = MIN_TOTAL_BEATS
    for (const trk of sharedTracks) {
      if (Array.isArray(trk.clips)) {
        for (const clip of trk.clips) {
          const endBeat = (clip.inicio ?? 0) + (clip.duracion ?? 16)
          if (endBeat > maxBeat) maxBeat = endBeat
        }
      }
    }
    return Math.ceil(maxBeat / beatsPerBar + 16) * beatsPerBar
  }, [sharedTracks])
  const TOTAL_BARS = TOTAL_BEATS / beatsPerBar

  const toggles = useMemo<Record<string, TrackToggle>>(() => {
    const map: Record<string, TrackToggle> = {}
    for (const track of tracks) {
      map[track.id] = {
        muted: track.muted ?? false,
        solo: track.solo ?? false,
        input: track.input ?? false,
        armed: track.armed ?? false,
      }
    }
    return map
  }, [tracks])

  const pixelsPerBeat = BASE_PIXELS_PER_BEAT * zoom
  const contentWidth = Math.max(TOTAL_BEATS * pixelsPerBeat, viewportWidth)

  const projection: TimelineProjection = useMemo(
    () =>
      createProjection({
        pixelsPerBeat,
        viewportWidth,
        scrollX: scrollLeft,
        bpm,
      }),
    [pixelsPerBeat, scrollLeft, viewportWidth, bpm],
  )

  // ResizeObserver para mantener viewportWidth reactivo
  useEffect(() => {
    const el = timelineRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w =
          entry.contentBoxSize?.[0]?.inlineSize ??
          entry.contentRect.width
        if (w > 0) setViewportWidth(w)
      }
    })
    obs.observe(el)
    // Initial read
    if (el.clientWidth > 0) setViewportWidth(el.clientWidth)
    return () => obs.disconnect()
  }, [])

  // Actualizar altura del área de pistas para regla y líneas
  useEffect(() => {
    if (timelineRef.current) {
      setTrackAreaHeight(timelineRef.current.scrollHeight)
    }
  }, [tracks.length, zoom])

  const handleAddTrack = async (tipo: 'audio' | 'midi') => {
    const count = sharedTracks.length + 1
    const nombre = tipo === 'midi' ? `MIDI ${count}` : `Audio ${count}`
    await tienda.executor.execute('track.create', { nombre, tipo })
    setShowAddTrackMenu(false)
  }

  const handleImportToTrack = async (trackId: string, file: File) => {
    await addClipFromFile(trackId, file, 0)
  }

  const handleDeleteTrack = async (trackId: string) => {
    setDeleteConfirmTrack(trackId)
  }

  const confirmDeleteTrack = async () => {
    if (deleteConfirmTrack) {
      await tienda.executor.execute('track.delete', { trackId: deleteConfirmTrack })
      setDeleteConfirmTrack(null)
    }
  }

  const toggle = (id: string, key: keyof TrackToggle) => {
    const current = toggles[id]?.[key] ?? false
    const next = !current

    if (key === 'muted') {
      void tienda.executor.execute('track.toggleMute', { trackId: id })
    } else if (key === 'solo') {
      void tienda.executor.execute('track.toggleSolo', { trackId: id })
    } else if (key === 'armed') {
      void tienda.executor.execute('track.update', { trackId: id, datos: { armada: next } })
    } else if (key === 'input') {
      void tienda.executor.execute('track.update', {
        trackId: id,
        datos: { configuracion: { monitorizarEntrada: next } },
      })
    }
  }

  // Close add-track menu on outside click
  useEffect(() => {
    if (!showAddTrackMenu) return
    const handler = (e: MouseEvent) => {
      if (addTrackMenuRef.current && !addTrackMenuRef.current.contains(e.target as Node)) {
        setShowAddTrackMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAddTrackMenu])

  // Note: keyboard shortcuts are now handled by useShortcutDispatcher (unified system)

  const seekFromEvent = useCallback(
    (clientX: number) => {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const x = clientX - rect.left
      const beat = projection.pixelToBeat(x)
      seekToBeats(Math.max(0, beat))
      // Actualizar tooltip de posición
      const bar = Math.floor(beat / beatsPerBar) + 1
      const beatInBar = Math.floor(beat % beatsPerBar) + 1
      setPlayheadTooltip({ beat: Math.max(0, beat), bar, beatInBar })
    },
    [projection, seekToBeats],
  )

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'select' || (activeTool as string) === 'move') {
      seekFromEvent(e.clientX)
    }
  }

  const handlePlayheadPointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(true)
    seekFromEvent(e.clientX)
    // Capturar puntero para arrastre fluido aunque el cursor salga del timeline
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handleTimelinePointerMove = (e: React.PointerEvent) => {
    if (dragging) {
      seekFromEvent(e.clientX)
    }

    if (clipDrag) {
      const deltaX = e.clientX - clipDrag.startMouseX
      const deltaBeats = deltaX / pixelsPerBeat

      if (clipDrag.mode === 'move') {
        const rawInicio = Math.max(0, clipDrag.initialInicio + deltaBeats)
        const newInicio =
          snapEnabled && snapValor > 0
            ? Math.round(rawInicio / snapValor) * snapValor
            : rawInicio

        // Determinar pista bajo el cursor (mover entre pistas)
        let previewTrackId = clipDrag.trackId
        if (lanesScrollRef.current) {
          const rect = lanesScrollRef.current.getBoundingClientRect()
          const yInContent = e.clientY - rect.top + lanesScrollRef.current.scrollTop
          const idx = Math.floor(yInContent / ROW_H)
          if (idx >= 0 && idx < tracks.length) {
            previewTrackId = tracks[idx].id
          }
        }

        setClipDrag((prev) =>
          prev
            ? { ...prev, previewInicio: newInicio, previewTrackId }
            : prev,
        )
      } else if (clipDrag.mode === 'trim-right') {
        const rawDur = Math.max(0.5, clipDrag.initialDuracion + deltaBeats)
        const newDur =
          snapEnabled && snapValor > 0
            ? Math.max(snapValor, Math.round(rawDur / snapValor) * snapValor)
            : rawDur
        setClipDrag((prev) =>
          prev ? { ...prev, previewDuracion: newDur } : prev,
        )
      } else if (clipDrag.mode === 'trim-left') {
        const rawInicio = Math.max(0, clipDrag.initialInicio + deltaBeats)
        const newInicio =
          snapEnabled && snapValor > 0
            ? Math.round(rawInicio / snapValor) * snapValor
            : rawInicio
        const deltaShift = newInicio - clipDrag.initialInicio
        const newDur = Math.max(0.5, clipDrag.initialDuracion - deltaShift)
        setClipDrag((prev) =>
          prev
            ? { ...prev, previewInicio: newInicio, previewDuracion: newDur }
            : prev,
        )
      }
    }
  }

  const handleTimelinePointerUp = (e?: React.PointerEvent) => {
    setDragging(false)
    setPlayheadTooltip(null)

    if (clipDrag) {
      if (clipDrag.mode === 'move') {
        void tienda.executor.execute('clip.move', {
          pistaId: clipDrag.trackId,
          clipId: clipDrag.clipId,
          inicio: clipDrag.previewInicio,
          ...(clipDrag.previewTrackId !== clipDrag.trackId
            ? { pistaDestinoId: clipDrag.previewTrackId }
            : {}),
        })
      } else if (clipDrag.mode === 'trim-right' || clipDrag.mode === 'trim-left') {
        void tienda.executor.execute('clip.resize', {
          pistaId: clipDrag.trackId,
          clipId: clipDrag.clipId,
          inicio: clipDrag.previewInicio,
          duracion: clipDrag.previewDuracion,
        })
      }
      setClipDrag(null)
    }

    if (e && (e.target as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    }
  }

  const handleZoom = useCallback(
    (e: React.WheelEvent) => {
      // Zoom horizontal: Ctrl/Cmd+rueda (o Alt+rueda) anclado al cursor
      if (!e.ctrlKey && !e.metaKey && !e.altKey) return
      e.preventDefault()
      e.stopPropagation()

      const lanes = lanesScrollRef.current
      if (!lanes) return

      const rect = lanes.getBoundingClientRect()
      const cursorX = e.clientX - rect.left
      lastPointerXRef.current = cursorX
      const direction: 'in' | 'out' = e.deltaY < 0 ? 'in' : 'out'

      // Usar scroll DOM real (más fiable que el estado) para anclar el beat bajo el cursor
      const liveScroll = lanes.scrollLeft
      const liveProjection = createProjection({
        pixelsPerBeat,
        viewportWidth: rect.width,
        scrollX: liveScroll,
        bpm,
      })
      const result = liveProjection.zoomAt(
        zoom,
        cursorX,
        direction,
        ARRANGE_MIN_ZOOM,
        ARRANGE_MAX_ZOOM,
      )

      if (Math.abs(result.zoom - zoom) < 1e-6) return

      tienda.establecerEstado((s) => ({
        ...s,
        ui: { ...s.ui, zoomHorizontal: result.zoom, scrollX: result.scrollAdjust },
      }))

      syncingScroll.current = true
      lanes.scrollLeft = result.scrollAdjust
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = result.scrollAdjust
      requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    },
    [pixelsPerBeat, zoom, tienda, bpm],
  )

  const applyZoomAtAnchor = useCallback(
    (newZoom: number, anchorViewportX?: number) => {
      const lanes = lanesScrollRef.current
      if (!lanes) return
      const z = Math.min(ARRANGE_MAX_ZOOM, Math.max(ARRANGE_MIN_ZOOM, newZoom))
      if (Math.abs(z - zoom) < 1e-9) return

      const rect = lanes.getBoundingClientRect()
      const cursorX =
        anchorViewportX ??
        lastPointerXRef.current ??
        rect.width / 2
      const liveScroll = lanes.scrollLeft
      const oldPpb = pixelsPerBeat
      const beatAtCursor = (cursorX + liveScroll) / oldPpb
      const newPpb = BASE_PIXELS_PER_BEAT * z
      const newScroll = Math.max(0, beatAtCursor * newPpb - cursorX)

      tienda.establecerEstado((s) => ({
        ...s,
        ui: { ...s.ui, zoomHorizontal: z, scrollX: newScroll },
      }))
      syncingScroll.current = true
      lanes.scrollLeft = newScroll
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = newScroll
      requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    },
    [pixelsPerBeat, zoom, tienda],
  )

  useEffect(() => {
    const onToolbarZoom = (ev: Event) => {
      const z = (ev as CustomEvent<{ zoom: number }>).detail?.zoom
      if (typeof z === 'number') applyZoomAtAnchor(z)
    }
    window.addEventListener('jaswave-zoom-horizontal', onToolbarZoom)
    return () => window.removeEventListener('jaswave-zoom-horizontal', onToolbarZoom)
  }, [applyZoomAtAnchor])

  const applyScrollDelta = useCallback(
    (deltaPx: number) => {
      const lanes = lanesScrollRef.current
      if (!lanes || !Number.isFinite(deltaPx) || deltaPx === 0) return
      const maxScroll = Math.max(0, lanes.scrollWidth - lanes.clientWidth)
      const next = Math.max(0, Math.min(maxScroll, lanes.scrollLeft + deltaPx))
      if (Math.abs(next - lanes.scrollLeft) < 0.5) return

      syncingScroll.current = true
      lanes.scrollLeft = next
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = next
      tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, scrollX: next } }))
      requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    },
    [tienda],
  )

  useEffect(() => {
    const onScrollTimeline = (ev: Event) => {
      const deltaPx = (ev as CustomEvent<{ deltaPx?: number }>).detail?.deltaPx
      if (typeof deltaPx === 'number') applyScrollDelta(deltaPx)
    }
    window.addEventListener('jaswave-scroll-timeline', onScrollTimeline)
    return () => window.removeEventListener('jaswave-scroll-timeline', onScrollTimeline)
  }, [applyScrollDelta])

  // Restaurar scrollX del estado (sesión / zoom) al DOM
  useEffect(() => {
    const lanes = lanesScrollRef.current
    if (!lanes) return
    if (Math.abs(lanes.scrollLeft - scrollLeft) < 1) return
    syncingScroll.current = true
    lanes.scrollLeft = scrollLeft
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scrollLeft
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [scrollLeft])

  const syncFromLanes = useCallback(() => {
    if (syncingScroll.current) return
    syncingScroll.current = true
    const lanes = lanesScrollRef.current
    if (lanes) {
      if (headersScrollRef.current) {
        headersScrollRef.current.scrollTop = lanes.scrollTop
      }
      if (rulerScrollRef.current) {
        rulerScrollRef.current.scrollLeft = lanes.scrollLeft
      }
      tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, scrollX: lanes.scrollLeft } }))
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [tienda])

  const syncFromHeaders = useCallback(() => {
    if (syncingScroll.current) return
    syncingScroll.current = true
    const headers = headersScrollRef.current
    if (headers && lanesScrollRef.current) {
      lanesScrollRef.current.scrollTop = headers.scrollTop
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [])

  const syncFromRuler = useCallback(() => {
    if (syncingScroll.current) return
    syncingScroll.current = true
    const ruler = rulerScrollRef.current
    if (ruler && lanesScrollRef.current) {
      lanesScrollRef.current.scrollLeft = ruler.scrollLeft
      tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, scrollX: ruler.scrollLeft } }))
    }
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [tienda])

  const handleClipPointerDown = (
    e: React.PointerEvent,
    clip: { id: string; trackId: string; inicioBeats: number; duracionBeats: number },
    trackId: string,
  ) => {
    e.stopPropagation()
    tienda.executor.execute('selection.set', {
      idsClips: [clip.id],
      idsPistas: [],
      tipo: 'clip',
      idPrincipal: clip.id,
    })

    if (activeTool === 'eraser') {
      void tienda.executor.execute('clip.delete', { pistaId: trackId, clipId: clip.id })
      return
    }

    if (activeTool === 'split') {
      if (timelineRef.current) {
        const rect = timelineRef.current.getBoundingClientRect()
        const clickX = e.clientX - rect.left
        const clickBeat = Math.max(0, projection.pixelToBeat(clickX))
        void tienda.executor.execute('clip.split', {
          pistaId: trackId,
          clipId: clip.id,
          tiempo: clickBeat,
        })
      }
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const offsetX = e.clientX - rect.left

    let mode: DragMode = 'move'
    if (offsetX <= 10) {
      mode = 'trim-left'
    } else if (offsetX >= rect.width - 10) {
      mode = 'trim-right'
    }

    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {}

    setClipDrag({
      mode,
      clipId: clip.id,
      trackId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      initialInicio: clip.inicioBeats,
      initialDuracion: clip.duracionBeats,
      previewInicio: clip.inicioBeats,
      previewDuracion: clip.duracionBeats,
      previewTrackId: trackId,
    })
  }

  const handleTrackLaneClick = (e: React.MouseEvent, trackId: string) => {
    if (activeTool === 'pencil') {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickBeat = Math.max(0, projection.pixelToBeat(clickX))
      const snapBeat =
        snapEnabled && snapValor > 0
          ? Math.round(clickBeat / snapValor) * snapValor
          : clickBeat

      void tienda.executor.execute('clip.create', {
        pistaId: trackId,
        nombre: 'Nuevo Clip Audio',
        inicio: snapBeat,
        duracion: 16,
      })
    } else {
      tienda.executor.execute('selection.clear', { alcance: 'clips' })
    }
  }

  const playheadBeat = Math.max(0, (transportSeconds * bpm) / 60)
  const playheadLeft = projection.beatToPixel(playheadBeat)

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
    <div className="flex min-h-0 flex-1 w-full overflow-hidden">
      <ConfirmDialog
        open={deleteConfirmTrack !== null}
        onClose={() => setDeleteConfirmTrack(null)}
        onConfirm={confirmDeleteTrack}
        title="Eliminar pista"
        message="¿Estás seguro de que deseas eliminar esta pista? Esta acción no se puede deshacer."
        confirmLabel="Eliminar"
        variant="danger"
      />
      <input
        type="file"
        ref={addTrackFileRef}
        accept="audio/*,.wav,.mp3,.ogg,.webm,.flac"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (file && importTargetTrack) {
            await handleImportToTrack(importTargetTrack, file)
          }
          e.target.value = ''
        }}
      />
      {/* Columna de cabeceras de pista */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-border bg-panel">
        {/* Acciones superiores — misma altura que la regla */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3" style={{ height: HEADER_H }}>
          <div className="relative" ref={addTrackMenuRef}>
            <button
              type="button"
              onClick={() => setShowAddTrackMenu(!showAddTrackMenu)}
              aria-label="Añadir pista"
              className="flex size-8 items-center justify-center rounded-md bg-panel-raised text-foreground ring-1 ring-border hover:bg-accent"
            >
              <Plus className="size-4" />
            </button>
            {showAddTrackMenu && (
              <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-panel shadow-xl">
                <button
                  type="button"
                  onClick={() => handleAddTrack('audio')}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-foreground hover:bg-panel-raised rounded-t-lg"
                >
                  <FileAudio className="size-3.5 text-accent-amber" />
                  Pista de Audio
                </button>
                <button
                  type="button"
                  onClick={() => handleAddTrack('midi')}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-foreground hover:bg-panel-raised rounded-b-lg"
                >
                  <Music className="size-3.5 text-accent-cyan" />
                  Pista MIDI
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Añadir marcador en playhead"
            title="Marcador"
            onClick={() => {
              void tienda.executor.execute('marker.create', {
                nombre: `Marcador ${Math.floor(playheadBeat / beatsPerBar) + 1}`,
                tiempo: playheadBeat,
              })
            }}
            className="rounded px-1.5 text-[10px] font-bold text-muted-foreground hover:bg-panel-raised hover:text-foreground"
          >
            M
          </button>
          <button
            type="button"
            aria-label="Cuadrícula"
            onClick={() => void tienda.executor.execute('timeline.setSnap', { snap: !snapEnabled, snapValor })}
            className={`ml-auto text-muted-foreground hover:text-foreground ${snapEnabled ? 'text-accent-amber' : ''}`}
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>

        {/* Cabeceras — scroll Y sincronizado con carriles */}
        <div
          ref={headersScrollRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          onScroll={syncFromHeaders}
        >
          {tracks.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
              <Music className="size-8 text-muted-foreground/40" />
              <div>
                <p className="text-[13px] font-semibold text-foreground">Sin pistas</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Crea una pista de audio o MIDI para empezar.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleAddTrack('audio')}
                  className="rounded-md bg-accent-amber px-3 py-1.5 text-[12px] font-medium text-background hover:opacity-90"
                >
                  Nueva pista de audio
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddTrack('midi')}
                  className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-panel-raised"
                >
                  Nueva pista MIDI
                </button>
              </div>
            </div>
          )}
          {tracks.map((track) => {
            const t = toggles[track.id] ?? {
              muted: false,
              solo: false,
              input: false,
              armed: false,
            }
            return (
              <div
                key={track.id}
                className="flex items-center gap-2 border-b border-border pr-3"
                style={{ height: ROW_H }}
              >
                <span
                  className="h-full w-1 shrink-0"
                  style={{ backgroundColor: track.color }}
                />
                <Mic2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-[13px] font-medium text-foreground">
                  {track.name}
                </span>
                <div className="flex items-center gap-1">
                  <TrackButton
                    label={`Silenciar ${track.name}`}
                    active={t.muted}
                    onClick={() => toggle(track.id, 'muted')}
                  >
                    M
                  </TrackButton>
                  <TrackButton
                    label={`Solo ${track.name}`}
                    active={t.solo}
                    activeClass="bg-track-vocals text-background"
                    onClick={() => toggle(track.id, 'solo')}
                  >
                    S
                  </TrackButton>
                  <TrackButton
                    label={`Entrada ${track.name}`}
                    active={t.input}
                    activeClass="bg-track-fx text-background"
                    onClick={() => toggle(track.id, 'input')}
                  >
                    i
                  </TrackButton>
                  <button
                    type="button"
                    onClick={() => toggle(track.id, 'armed')}
                    aria-label={`Armar ${track.name}`}
                    aria-pressed={t.armed}
                    className={`flex size-5 items-center justify-center rounded ring-1 transition-colors ${
                      t.armed
                        ? 'bg-destructive text-background ring-destructive'
                        : 'bg-panel-raised text-muted-foreground ring-border hover:text-destructive'
                    }`}
                  >
                    <Circle className="size-2.5" fill={t.armed ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportTargetTrack(track.id)
                      addTrackFileRef.current?.click()
                    }}
                    aria-label={`Importar audio a ${track.name}`}
                    className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-accent-amber hover:bg-panel-raised transition-colors"
                  >
                    <Upload className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTrack(track.id)}
                    aria-label={`Opciones ${track.name}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Área de la línea de tiempo */}
      <div className="relative flex min-w-0 flex-1 flex-col bg-track-lane">
        {/* Regla — scroll X sincronizado */}
        <div
          ref={rulerScrollRef}
          className="shrink-0 overflow-x-auto overflow-y-hidden border-b border-border bg-panel"
          style={{ height: HEADER_H }}
          onScroll={syncFromRuler}
        >
          <div
            className="relative cursor-pointer select-none"
            style={{ width: `${contentWidth}px`, height: HEADER_H, minWidth: '100%' }}
            onClick={handleSeek}
          >
            <TimeRuler projection={projection} zoom={zoom} totalHeight={HEADER_H} bpm={bpm} beatsPerBar={beatsPerBar} />
            <div
              className="absolute top-0 bottom-0 z-20 w-[2px] cursor-ew-resize bg-accent-amber/80"
              style={{ left: playheadLeft }}
              onPointerDown={handlePlayheadPointerDown}
              onPointerUp={handleTimelinePointerUp}
            >
              <div
                className="absolute -left-[5px] bottom-0 h-2.5 w-3 rounded-sm bg-accent-amber"
                style={{ clipPath: 'polygon(50% 0%, 0 100%, 100% 100%)' }}
              />
            </div>
          </div>
        </div>

        {/* Carriles — scroll X+Y; Y sincronizado con cabeceras */}
        <div
          ref={(el) => {
            lanesScrollRef.current = el
            timelineRef.current = el
          }}
          className="relative min-h-0 flex-1 overflow-auto"
          onScroll={syncFromLanes}
          onPointerMove={(e) => {
            if (lanesScrollRef.current) {
              lastPointerXRef.current =
                e.clientX - lanesScrollRef.current.getBoundingClientRect().left
            }
            handleTimelinePointerMove(e)
          }}
          onPointerUp={handleTimelinePointerUp}
          onPointerLeave={handleTimelinePointerUp}
          onWheel={handleZoom}
        >
          <div
            ref={contentRef}
            className="relative"
            style={{ width: `${contentWidth}px`, minWidth: '100%' }}
          >
            {/* Carriles */}
            <div className="relative cursor-pointer" data-track-area>
              <GridLines projection={projection} zoom={zoom} beatsPerBar={beatsPerBar} />

            {/* Loop region overlay */}
            {loopActivo && loopFinBeats > loopInicioBeats && (
              <>
                {/* Zona antes del loop (oscurecida) */}
                <div
                  className="absolute inset-y-0 z-5 bg-black/20 pointer-events-none"
                  style={{
                    left: 0,
                    width: Math.max(0, projection.beatToPixel(loopInicioBeats)),
                  }}
                />
                {/* Borde izquierdo del loop */}
                <div
                  className="absolute inset-y-0 z-5 w-[2px] bg-accent-cyan pointer-events-none"
                  style={{ left: projection.beatToPixel(loopInicioBeats) }}
                />
                {/* Borde derecho del loop */}
                <div
                  className="absolute inset-y-0 z-5 w-[2px] bg-accent-cyan pointer-events-none"
                  style={{ left: projection.beatToPixel(loopFinBeats) }}
                />
                {/* Zona después del loop (oscurecida) */}
                <div
                  className="absolute inset-y-0 z-5 bg-black/20 pointer-events-none"
                  style={{
                    left: projection.beatToPixel(loopFinBeats),
                    right: 0,
                  }}
                />
                {/* Etiqueta del loop */}
                <div
                  className="absolute top-0 z-5 flex items-center rounded-b-sm bg-accent-cyan/80 px-1.5 py-0.5 pointer-events-none"
                  style={{
                    left: projection.beatToPixel(loopInicioBeats),
                    width: Math.max(0, projection.beatToPixel(loopFinBeats) - projection.beatToPixel(loopInicioBeats)),
                  }}
                >
                  <span className="text-[9px] font-semibold text-background truncate">
                    Bucle · {Math.round(loopFinBeats - loopInicioBeats)} beats
                  </span>
                </div>
              </>
            )}

            {/* Cabezal de reproducción */}
            <div
              className="touch-none absolute inset-y-0 z-30 w-[3px] cursor-ew-resize bg-accent-amber"
              style={{
                left: playheadLeft,
                boxShadow: dragging
                  ? '0 0 8px color-mix(in oklch, var(--accent-amber) 60%, transparent)'
                  : undefined,
              }}
              onPointerDown={handlePlayheadPointerDown}
              onPointerUp={handleTimelinePointerUp}
            >
              <div
                className="absolute -left-[7px] -top-1 h-3 w-4 rounded-sm bg-accent-amber"
                style={{ clipPath: 'polygon(50% 100%, 0 0, 100% 0)' }}
              />
              <div className="absolute -left-1.5 top-1/2 size-3 -translate-y-1/2 rounded-full border-2 border-accent-amber bg-background" />
              {/* Tooltip de posición al arrastrar */}
              {dragging && playheadTooltip && (
                <div
                  className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-background/90 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-foreground ring-1 ring-border backdrop-blur-sm"
                >
                  {playheadTooltip.bar}.{playheadTooltip.beatInBar}
                </div>
              )}
            </div>

            {tracks.map((track) => {
              const t = toggles[track.id] ?? {
                muted: false,
                solo: false,
                input: false,
                armed: false,
              }

              // Clips visibles en este carril (soporta preview al mover entre pistas)
              let trackClips = clips.filter((c) => c.trackId === track.id)
              if (clipDrag?.mode === 'move') {
                trackClips = trackClips.filter((c) => c.id !== clipDrag.clipId)
                if (clipDrag.previewTrackId === track.id) {
                  const dragged = clips.find((c) => c.id === clipDrag.clipId)
                  if (dragged) {
                    trackClips = [
                      ...trackClips,
                      {
                        ...dragged,
                        inicioBeats: clipDrag.previewInicio,
                        duracionBeats: clipDrag.previewDuracion,
                      },
                    ]
                  }
                }
              }

              const isDropTarget =
                clipDrag?.mode === 'move' && clipDrag.previewTrackId === track.id

              return (
                <div
                  key={track.id}
                  className={`relative border-b border-border transition-colors hover:bg-panel-raised/30 ${
                    isDropTarget ? 'bg-accent-amber/10' : ''
                  }`}
                  style={{ height: ROW_H }}
                  onClick={(e) => handleTrackLaneClick(e, track.id)}
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'copy'
                  }}
                  onDrop={async (e) => {
                    e.preventDefault()
                    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                      const file = e.dataTransfer.files[0]
                      const rect = e.currentTarget.getBoundingClientRect()
                      const dropX = e.clientX - rect.left
                      const dropBeat = Math.max(0, projection.pixelToBeat(dropX))
                      await addClipFromFile(track.id, file, dropBeat)
                    }
                  }}
                >
                  {trackClips.length === 0 ? (
                    <div
                      className="pointer-events-none absolute inset-0 flex items-center pl-3 opacity-30"
                      style={{ height: ROW_H }}
                    >
                      <span className="text-[11px] italic text-muted-foreground">
                        {activeTool === 'pencil'
                          ? '✏ Haz clic para crear un clip'
                          : '↓ Arrastra un archivo de audio aquí'}
                      </span>
                    </div>
                  ) : (
                    trackClips.map((clip) => {
                      const isDraggingThis = clipDrag?.clipId === clip.id
                      const inicio =
                        isDraggingThis && clipDrag.mode !== 'move'
                          ? clipDrag.previewInicio
                          : isDraggingThis
                            ? clipDrag.previewInicio
                            : clip.inicioBeats
                      const duracion =
                        isDraggingThis ? clipDrag.previewDuracion : clip.duracionBeats
                      const clipLeft = projection.beatToPixel(inicio)
                      const clipWidth = Math.max(36, duracion * pixelsPerBeat)
                      const isSelected = selectedClipId === clip.id
                      const barStart = Math.floor(inicio / beatsPerBar) + 1
                      const barEnd = Math.ceil((inicio + duracion) / beatsPerBar)
                      const barCount = barEnd - barStart + 1

                      return (
                        <div
                          key={clip.id}
                          onPointerDown={(e) => handleClipPointerDown(e, clip, clip.trackId)}
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            if (clip.kind === 'midi') {
                              void tienda.executor.execute('selection.set', {
                                idsClips: [clip.id],
                                idsPistas: [clip.trackId],
                                idPrincipal: clip.trackId,
                              })
                              requestOpenTool('piano-roll', { zone: 'bottom' })
                            } else {
                              requestOpenTool('track-detail', { zone: 'right' })
                            }
                          }}
                          className={`group absolute inset-y-1 touch-none select-none overflow-hidden rounded-md border shadow-md transition-shadow ${
                            activeTool === 'split'
                              ? 'cursor-crosshair'
                              : activeTool === 'eraser'
                                ? 'cursor-not-allowed'
                                : 'cursor-grab active:cursor-grabbing'
                          } ${
                            isSelected
                              ? 'z-20 border-accent-amber shadow-lg ring-2 ring-accent-amber ring-offset-0'
                              : 'z-10 hover:brightness-110'
                          }`}
                          style={{
                            left: `${clipLeft}px`,
                            width: `${clipWidth}px`,
                            background: `linear-gradient(180deg, color-mix(in oklch, ${track.color} 42%, transparent) 0%, color-mix(in oklch, ${track.color} 22%, transparent) 100%)`,
                            borderColor: isSelected
                              ? undefined
                              : `color-mix(in oklch, ${track.color} 80%, transparent)`,
                            opacity: t.muted ? 0.35 : 1,
                          }}
                          title={`${clip.name} — Compás ${barStart}→${barEnd} (${clip.duracionSeconds.toFixed(2)}s)`}
                        >
                          <div
                            className="absolute bottom-0 left-0 top-0 z-10 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
                            style={{ background: `linear-gradient(to right, ${track.color}, transparent)` }}
                          />
                          <div
                            className="absolute bottom-0 right-0 top-0 z-10 w-2 cursor-ew-resize opacity-0 transition-opacity group-hover:opacity-100"
                            style={{ background: `linear-gradient(to left, ${track.color}, transparent)` }}
                          />

                          <div className="flex items-center gap-1.5 px-2 pt-0.5">
                            <span
                              className="size-1.5 shrink-0 rounded-full opacity-90"
                              style={{ backgroundColor: track.color }}
                            />
                            <span className="flex-1 truncate text-[10px] font-semibold leading-tight text-foreground">
                              {clip.name}
                              {clip.kind === 'midi' ? ' · MIDI' : ''}
                            </span>
                            {clipWidth > 80 && (
                              <span className="shrink-0 font-mono text-[9px] opacity-60">
                                {clip.kind === 'midi' && clip.noteCount != null
                                  ? `${clip.noteCount} notas`
                                  : `${barCount}b · ${clip.duracionSeconds.toFixed(1)}s`}
                              </span>
                            )}
                          </div>

                          <div
                            className="relative mx-1 mb-0.5 overflow-hidden rounded-sm"
                            style={{ height: ROW_H - 22 }}
                          >
                            {clip.kind === 'midi' ? (
                              <div className="flex h-full items-end gap-px px-0.5 opacity-80">
                                {Array.from({ length: Math.min(48, Math.max(8, Math.floor(clipWidth / 4))) }).map(
                                  (_, i) => (
                                    <div
                                      key={i}
                                      className="flex-1 rounded-sm"
                                      style={{
                                        height: `${20 + ((i * 17) % 60)}%`,
                                        backgroundColor: track.color,
                                        opacity: 0.35 + ((i * 13) % 50) / 100,
                                      }}
                                    />
                                  ),
                                )}
                              </div>
                            ) : (
                              <StereoWaveform
                                waveform={clip.waveform}
                                sourceId={clip.sourceId}
                                color={track.color}
                                width={Math.max(8, clipWidth - 8)}
                                height={ROW_H - 24}
                                durationSeconds={Math.max(0.001, clip.duracionSeconds)}
                                clipLeft={clipLeft + 4}
                                scrollLeft={scrollLeft}
                                viewportWidth={viewportWidth}
                              />
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
        </div>
      </div>
    </div>
    </div>
  )
}

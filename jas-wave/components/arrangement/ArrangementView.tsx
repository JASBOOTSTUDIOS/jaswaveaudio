import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, LayoutGrid, Mic2, MoreVertical, Circle, Music, Upload, FileAudio, Headphones, GripVertical } from 'lucide-react'
import { usePlaybackActions } from '@/components/playback-provider'
import { createProjection } from '@/lib/timeline-projection'
import { TRACKS, type Track as UiTrack } from '@/lib/daw-data'
import { useDAW, useDAWState } from '../../src/context/daw-context'
import type { DAWState } from '../../../shared/src'
import { linealADb, panADisplay } from '@/lib/audio-conversions'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { StereoWaveform } from '../stereo-waveform'
import { requestOpenTool } from '@/src/workspace/types'
import { TrackButton } from './TrackButton'
import { TimelineRuler } from './TimelineRuler'
import { GridLayer } from './GridLayer'
import { PlayheadOverlay } from './PlayheadOverlay'
import { ArrangeBoard } from './ArrangeBoard'
import { AutomationLanesPanel } from '@/components/automation-lanes-panel'
import { TrackAddPluginButton } from './TrackAddPluginButton'
import { MidiClipPreview } from './MidiClipPreview'
import { ChannelFxBank } from '@/components/channel-fx-bank'
import { TrackMidiInput } from '@/components/track-midi-input'
import { TrackAudioInput } from '@/components/track-audio-input'
import { TrackContextMenu, type TrackMenuState } from './TrackContextMenu'
import { ClipContextMenu, type ClipMenuState } from './ClipContextMenu'
import { clipsInLassoRect, type ClipLassoRect } from '@/src/lib/arrange-clip-lasso'
import type { PluginInfo } from '../../../shared/src/types/entidades'
import {
  ROW_H,
  HEADER_H,
  MIN_TOTAL_BEATS,
  BASE_PIXELS_PER_BEAT,
  ARRANGE_MIN_ZOOM,
  ARRANGE_MAX_ZOOM,
} from './constants'
import { useTimelineScale } from '@/hooks/arrangement/useTimelineScale'
import { useSnap } from '@/hooks/arrangement/useSnap'
import { getSelectedTrackId, selectTrackPayload } from '@/src/lib/selection-helpers'

export { ARRANGE_MIN_ZOOM, ARRANGE_MAX_ZOOM } from './constants'

type UiLikeTrack = UiTrack & {
  muted?: boolean
  solo?: boolean
  input?: boolean
  armed?: boolean
  tipo?: string
  entrada?: string
  dispositivoEntrada?: string
  plugins?: PluginInfo[]
}

type TrackToggle = { muted: boolean; solo: boolean; input: boolean; armed: boolean }

function toUiLikeTrack(track: unknown): UiLikeTrack {
  const anyTrack = track as Record<string, unknown>
  const ui = TRACKS.find((t) => t.id === String(anyTrack.id ?? ''))
  const cfg = anyTrack.configuracion as { monitorizarEntrada?: boolean } | undefined
  return {
    id: String(anyTrack.id ?? ''),
    name: ui?.name ?? String(anyTrack.nombre ?? ''),
    color: ui?.color ?? String(anyTrack.color ?? '#888'),
    seed: ui?.seed ?? 0,
    db: typeof anyTrack.volumen === 'number' ? linealADb(anyTrack.volumen) : ui?.db ?? 0,
    pan: typeof anyTrack.paneo === 'number' ? panADisplay(anyTrack.paneo) : ui?.pan ?? 0,
    muted: Boolean(anyTrack.silenciada),
    solo: Boolean(anyTrack.soloActiva),
    input: Boolean(cfg?.monitorizarEntrada),
    armed: Boolean(anyTrack.armada),
    tipo: String(anyTrack.tipo ?? ''),
    entrada: typeof anyTrack.entrada === 'string' ? anyTrack.entrada : '',
    dispositivoEntrada:
      typeof anyTrack.dispositivoEntrada === 'string'
        ? anyTrack.dispositivoEntrada
        : typeof anyTrack.entrada === 'string'
          ? anyTrack.entrada
          : '',
    plugins: Array.isArray(anyTrack.plugins) ? (anyTrack.plugins as PluginInfo[]) : [],
  }
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

export function ArrangementView() {
  const tienda = useDAW()
  const sharedTracks = useDAWState((state: DAWState) => state.project?.tracks || [])
  const activeTool = useDAWState((state: DAWState) => state.ui?.herramientaActiva || 'select')
  const snapValor = useDAWState((state: DAWState) => state.project?.timeline?.snapValor ?? 1)
  const snapEnabled = useDAWState((state: DAWState) => state.project?.timeline?.snap ?? true)
  const bpm = useDAWState((state: DAWState) => state.project?.bpm?.valor ?? 120)
  const beatsPerBar = useDAWState((state: DAWState) => state.project?.timeSignature?.numerador ?? 4)
  const loopState = useDAWState((state: DAWState) => state.transport?.loop)
  const zoom = useDAWState((state: DAWState) => state.ui?.zoomHorizontal ?? 1)
  const zoomVertical = useDAWState((state: DAWState) => state.ui?.zoomVertical ?? 1)
  const scrollLeft = useDAWState((state: DAWState) => state.ui?.scrollX ?? 0)
  const selectedClipId = useDAWState((state: DAWState) => state.selection?.idsClips?.[0] ?? null)
  const selectedClipIds = useDAWState((state: DAWState) => state.selection?.idsClips ?? [])
  const selectedTrackId = useDAWState((state: DAWState) => getSelectedTrackId(state))
  const loopActivo = Boolean(loopState?.activo)
  const loopInicioBeats = loopState?.inicio?.beats ?? 0
  const loopFinBeats = loopState?.fin?.beats ?? 0

  const { seekToBeats, clips, addClipFromFile, getPositionMs } = usePlaybackActions()
  const timelineRef = useRef<HTMLDivElement>(null)
  const lanesScrollRef = useRef<HTMLDivElement>(null)
  const rulerScrollRef = useRef<HTMLDivElement>(null)
  const syncingScroll = useRef(false)
  const lastPointerXRef = useRef<number | null>(null)

  const [dragging, setDragging] = useState(false)
  const [playheadTooltip, setPlayheadTooltip] = useState<{ beat: number; bar: number; beatInBar: number } | null>(null)
  const [viewportWidth, setViewportWidth] = useState(800)
  const [liveScrollX, setLiveScrollX] = useState(0)

  const [clipDrag, setClipDrag] = useState<ClipDragState | null>(null)
  const clipDragRef = useRef<ClipDragState | null>(null)
  const lastClipDragUiMs = useRef(0)
  clipDragRef.current = clipDrag
  const [showAddTrackMenu, setShowAddTrackMenu] = useState(false)
  const addTrackMenuRef = useRef<HTMLDivElement>(null)
  const addTrackFileRef = useRef<HTMLInputElement>(null)
  const [importTargetTrack, setImportTargetTrack] = useState<string | null>(null)
  const [deleteConfirmTrack, setDeleteConfirmTrack] = useState<string | null>(null)
  const [trackMenu, setTrackMenu] = useState<TrackMenuState | null>(null)
  const [clipMenu, setClipMenu] = useState<ClipMenuState | null>(null)
  const [clipLasso, setClipLasso] = useState<ClipLassoRect | null>(null)
  const clipLassoActiveRef = useRef(false)
  const [dragTrackId, setDragTrackId] = useState<string | null>(null)
  const [dragOverTrackId, setDragOverTrackId] = useState<string | null>(null)

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

  const { projection, pixelsPerBeat } = useTimelineScale({
    zoom,
    scrollX: scrollLeft,
    viewportWidth,
    bpm,
  })
  const contentWidth = Math.max(TOTAL_BEATS * pixelsPerBeat, viewportWidth)
  const viewProjection = useMemo(
    () =>
      createProjection({
        pixelsPerBeat,
        viewportWidth,
        scrollX: liveScrollX,
        bpm,
      }),
    [pixelsPerBeat, viewportWidth, liveScrollX, bpm],
  )
  const { snapBeat, snapDuration } = useSnap(snapEnabled, snapValor)

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

  const handleAddTrack = async (tipo: 'audio' | 'midi') => {
    const count = sharedTracks.length + 1
    const nombre = tipo === 'midi' ? `MIDI ${count}` : `Audio ${count}`
    await tienda.executor.execute('track.create', { nombre, tipo })
    setShowAddTrackMenu(false)
  }

  const handleImportToTrack = async (trackId: string, file: File) => {
    await addClipFromFile(trackId, file, 0)
  }

  const openTrackMenu = useCallback((trackId: string, clientX: number, clientY: number) => {
    setClipMenu(null)
    void tienda.executor.execute('selection.set', selectTrackPayload(trackId))
    setTrackMenu({ trackId, x: clientX, y: clientY })
  }, [tienda])

  const openClipMenu = useCallback(
    (clipIds: string[], trackId: string, clientX: number, clientY: number, beatAtClick?: number) => {
      if (!clipIds.length) return
      setTrackMenu(null)
      void tienda.executor.execute('selection.set', {
        idsClips: clipIds,
        idsPistas: [trackId],
        tipo: 'clip',
        idPrincipal: trackId,
      })
      setClipMenu({ clipIds, trackId, x: clientX, y: clientY, beatAtClick })
    },
    [tienda],
  )

  const handleDeleteTrack = (trackId: string) => {
    setDeleteConfirmTrack(trackId)
  }

  const confirmDeleteTrack = async () => {
    if (deleteConfirmTrack) {
      await tienda.executor.execute('track.delete', { trackId: deleteConfirmTrack })
      setDeleteConfirmTrack(null)
    }
  }

  const moveTrackToIndex = useCallback(
    (trackId: string, toIndex: number) => {
      void tienda.executor.execute('track.move', { trackId, toIndex })
    },
    [tienda],
  )

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
      void tienda.executor.execute('track.toggleMonitor', { trackId: id })
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

  const TRACK_COL_W = 300
  const rowH = Math.max(56, Math.round(ROW_H * zoomVertical))

  const beginClipRightDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 2) return
      const scroller = lanesScrollRef.current
      if (!scroller) return
      e.preventDefault()
      e.stopPropagation()

      const clipEl = (e.target as HTMLElement).closest('[data-clip-id]')
      const clipId = clipEl?.getAttribute('data-clip-id') ?? undefined
      const trackId =
        clipEl?.getAttribute('data-track-id') ??
        (e.target as HTMLElement).closest('[data-track-id]')?.getAttribute('data-track-id') ??
        undefined

      const scrollerRect = scroller.getBoundingClientRect()
      const toLocal = (clientX: number, clientY: number) => ({
        x: clientX - scrollerRect.left - TRACK_COL_W + scroller.scrollLeft,
        y: clientY - scrollerRect.top + scroller.scrollTop,
      })
      const start = toLocal(e.clientX, e.clientY)
      const startClient = { x: e.clientX, y: e.clientY }
      clipLassoActiveRef.current = false
      setClipLasso({ x0: start.x, y0: start.y, x1: start.x, y1: start.y })

      const captureEl = e.currentTarget as HTMLElement
      try {
        captureEl.setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }

      const move = (ev: PointerEvent) => {
        if (Math.hypot(ev.clientX - startClient.x, ev.clientY - startClient.y) > 4) {
          clipLassoActiveRef.current = true
        }
        const p = toLocal(ev.clientX, ev.clientY)
        setClipLasso({ x0: start.x, y0: start.y, x1: p.x, y1: p.y })
      }
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        try {
          captureEl.releasePointerCapture(ev.pointerId)
        } catch {
          /* ignore */
        }
        setClipLasso(null)
        const p = toLocal(ev.clientX, ev.clientY)
        const lassoRect = { x0: start.x, y0: start.y, x1: p.x, y1: p.y }
        if (clipLassoActiveRef.current) {
          const hitIds = clipsInLassoRect(
            clips.map((c) => ({
              id: c.id,
              trackId: c.trackId,
              inicioBeats: c.inicioBeats,
              duracionBeats: c.duracionBeats,
            })),
            tracks,
            rowH,
            (beat) => projection.beatToPixel(beat),
            lassoRect,
          )
          if (hitIds.length) {
            const trackIds = [
              ...new Set(
                hitIds
                  .map((id) => clips.find((c) => c.id === id)?.trackId)
                  .filter((id): id is string => Boolean(id)),
              ),
            ]
            const primaryTrack = trackIds[0] ?? trackId ?? tracks[0]?.id
            if (primaryTrack) {
              void tienda.executor.execute('selection.set', {
                idsClips: hitIds,
                idsPistas: trackIds.length ? trackIds : [primaryTrack],
                tipo: 'clip',
                idPrincipal: primaryTrack,
              })
            }
          }
          return
        }
        let beatAtClick: number | undefined
        if (timelineRef.current) {
          const tRect = timelineRef.current.getBoundingClientRect()
          beatAtClick = Math.max(0, projection.pixelToBeat(ev.clientX - tRect.left))
        }
        const currentIds = tienda.obtenerEstado().selection?.idsClips ?? []
        if (clipId && trackId) {
          const ids =
            currentIds.includes(clipId) && currentIds.length > 1 ? currentIds : [clipId]
          openClipMenu(ids, trackId, ev.clientX, ev.clientY, beatAtClick)
          return
        }
        if (currentIds.length > 0) {
          const menuTrackId =
            clips.find((c) => c.id === currentIds[0])?.trackId ?? tracks[0]?.id ?? ''
          if (menuTrackId) openClipMenu(currentIds, menuTrackId, ev.clientX, ev.clientY, beatAtClick)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [clips, tracks, rowH, projection, tienda, openClipMenu],
  )

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const scroller = lanesScrollRef.current
      if (!scroller) return
      const rect = scroller.getBoundingClientRect()
      const x = clientX - rect.left + scroller.scrollLeft - TRACK_COL_W
      const beat = projection.pixelToBeat(Math.max(0, x))
      seekToBeats(Math.max(0, beat))
      const bar = Math.floor(beat / beatsPerBar) + 1
      const beatInBar = Math.floor(beat % beatsPerBar) + 1
      setPlayheadTooltip({ beat: Math.max(0, beat), bar, beatInBar })
    },
    [projection, seekToBeats, beatsPerBar],
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

    const drag = clipDragRef.current
    if (!drag) return

    const deltaX = e.clientX - drag.startMouseX
    const deltaBeats = deltaX / pixelsPerBeat
    let next: ClipDragState = drag

    if (drag.mode === 'move') {
      const rawInicio = Math.max(0, drag.initialInicio + deltaBeats)
      const newInicio = snapBeat(rawInicio)
      let previewTrackId = drag.trackId
      if (lanesScrollRef.current) {
        const rect = lanesScrollRef.current.getBoundingClientRect()
        const yInContent = e.clientY - rect.top + lanesScrollRef.current.scrollTop
        const idx = Math.floor(yInContent / rowH)
        if (idx >= 0 && idx < tracks.length) {
          previewTrackId = tracks[idx]!.id
        }
      }
      next = { ...drag, previewInicio: newInicio, previewTrackId }
    } else if (drag.mode === 'trim-right') {
      const newDur = snapDuration(Math.max(0.5, drag.initialDuracion + deltaBeats))
      next = { ...drag, previewDuracion: newDur }
    } else if (drag.mode === 'trim-left') {
      const newInicio = snapBeat(Math.max(0, drag.initialInicio + deltaBeats))
      const deltaShift = newInicio - drag.initialInicio
      const newDur = Math.max(0.5, drag.initialDuracion - deltaShift)
      next = { ...drag, previewInicio: newInicio, previewDuracion: newDur }
    }

    clipDragRef.current = next
    const now = performance.now()
    // Preview a ~30fps: evita re-render completo del arrangement en cada pixel
    if (now - lastClipDragUiMs.current >= 32) {
      lastClipDragUiMs.current = now
      setClipDrag(next)
    }
  }

  const handleTimelinePointerUp = (e?: React.PointerEvent) => {
    setDragging(false)
    setPlayheadTooltip(null)

    const drag = clipDragRef.current
    if (drag) {
      if (drag.mode === 'move') {
        void tienda.executor.execute('clip.move', {
          pistaId: drag.trackId,
          clipId: drag.clipId,
          inicio: drag.previewInicio,
          ...(drag.previewTrackId !== drag.trackId
            ? { pistaDestinoId: drag.previewTrackId }
            : {}),
        })
      } else if (drag.mode === 'trim-right' || drag.mode === 'trim-left') {
        void tienda.executor.execute('clip.resize', {
          pistaId: drag.trackId,
          clipId: drag.clipId,
          inicio: drag.previewInicio,
          duracion: drag.previewDuracion,
        })
      }
      clipDragRef.current = null
      setClipDrag(null)
    }

    if (e && (e.target as HTMLElement)?.hasPointerCapture?.(e.pointerId)) {
      ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
    }
  }

  const handleZoom = useCallback(
    (e: WheelEvent) => {
      const lanes = lanesScrollRef.current
      if (!lanes) return

      const rect = lanes.getBoundingClientRect()
      const xInScroller = e.clientX - rect.left
      const overHeaders = xInScroller < TRACK_COL_W
      const ctrlZoom = e.ctrlKey || e.metaKey || e.altKey

      // Controles de pista: scroll vertical nativo (sin modificadores).
      if (overHeaders && !ctrlZoom) return

      // Ctrl/Cmd/Alt + rueda → zoom VERTICAL de altura de pistas (estilo Reaper TCP).
      if (ctrlZoom) {
        e.preventDefault()
        e.stopPropagation()
        const absDy = Math.abs(e.deltaY) || Math.abs(e.deltaX) || 100
        const ticks = Math.min(4, Math.max(1, Math.round(absDy / 80)))
        const step = 0.08 * ticks
        const directionUp = e.deltaY < 0 || (e.deltaY === 0 && e.deltaX < 0)
        const next = Math.min(3, Math.max(0.5, zoomVertical + (directionUp ? step : -step)))
        if (Math.abs(next - zoomVertical) < 1e-6) return
        tienda.establecerEstado((s) => ({
          ...s,
          ui: { ...s.ui, zoomVertical: Math.round(next * 100) / 100 },
        }))
        return
      }

      // Sobre clips: Shift+rueda = pan horizontal.
      if (!overHeaders && e.shiftKey) {
        e.preventDefault()
        e.stopPropagation()
        const deltaPx = e.deltaY !== 0 ? e.deltaY : e.deltaX
        if (!Number.isFinite(deltaPx) || deltaPx === 0) return
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
        return
      }

      // Rueda simple sobre clips → zoom HORIZONTAL (ancho de timeline).
      if (overHeaders) return

      e.preventDefault()
      e.stopPropagation()

      const lanesCursorX = Math.max(0, xInScroller - TRACK_COL_W)
      lastPointerXRef.current = xInScroller

      const absDy = Math.abs(e.deltaY) || Math.abs(e.deltaX) || 100
      const ticks = Math.min(6, Math.max(1, Math.round(absDy / 80)))
      const factorPerTick = 1.15
      const direction: 'in' | 'out' =
        e.deltaY < 0 || (e.deltaY === 0 && e.deltaX < 0) ? 'in' : 'out'

      const liveScroll = lanes.scrollLeft
      const lanesViewportW = Math.max(1, rect.width - TRACK_COL_W)
      let nextZoom = zoom
      let nextScroll = liveScroll
      let ppb = pixelsPerBeat

      for (let i = 0; i < ticks; i++) {
        const liveProjection = createProjection({
          pixelsPerBeat: ppb,
          viewportWidth: lanesViewportW,
          scrollX: nextScroll,
          bpm,
        })
        const result = liveProjection.zoomAt(
          nextZoom,
          lanesCursorX,
          direction,
          ARRANGE_MIN_ZOOM,
          ARRANGE_MAX_ZOOM,
          factorPerTick,
        )
        if (Math.abs(result.zoom - nextZoom) < 1e-9) break
        const ratio = result.zoom / nextZoom
        ppb *= ratio
        nextZoom = result.zoom
        nextScroll = result.scrollAdjust
      }

      if (Math.abs(nextZoom - zoom) < 1e-9) return

      tienda.establecerEstado((s) => ({
        ...s,
        ui: { ...s.ui, zoomHorizontal: nextZoom, scrollX: nextScroll },
      }))

      syncingScroll.current = true
      lanes.scrollLeft = nextScroll
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = nextScroll
      requestAnimationFrame(() => {
        syncingScroll.current = false
      })
    },
    [pixelsPerBeat, zoom, zoomVertical, tienda, bpm],
  )

  const applyZoomAtAnchor = useCallback(
    (newZoom: number, anchorViewportX?: number) => {
      const lanes = lanesScrollRef.current
      if (!lanes) return
      const z = Math.min(ARRANGE_MAX_ZOOM, Math.max(ARRANGE_MIN_ZOOM, newZoom))
      if (Math.abs(z - zoom) < 1e-9) return

      const rect = lanes.getBoundingClientRect()
      const rawX =
        anchorViewportX ??
        lastPointerXRef.current ??
        rect.width / 2
      const cursorX = Math.max(0, rawX - TRACK_COL_W)
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
    setLiveScrollX(scrollLeft)
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scrollLeft
    requestAnimationFrame(() => {
      syncingScroll.current = false
    })
  }, [scrollLeft])

  const tracksHeight = Math.max(tracks.length * rowH, rowH)

  const syncFromLanes = useCallback(() => {
    if (syncingScroll.current) return
    syncingScroll.current = true
    const lanes = lanesScrollRef.current
    if (lanes) {
      const x = lanes.scrollLeft
      setLiveScrollX(x)
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = x
      tienda.establecerEstado((s) => ({ ...s, ui: { ...s.ui, scrollX: x } }))
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
    if (e.button !== 0) return
    e.stopPropagation()
    // Liberar foco del piano roll / chat para que Ctrl+C/V lleguen a los atajos de clips
    try {
      window.getSelection()?.removeAllRanges()
    } catch {
      /* ignore */
    }
    const ae = document.activeElement
    if (ae instanceof HTMLElement && ae !== document.body) {
      ae.blur()
    }
    tienda.executor.execute('selection.set', {
      idsClips: [clip.id],
      idsPistas: [trackId],
      tipo: 'clip',
      idPrincipal: trackId,
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

  const selectTrack = (trackId: string) => {
    void tienda.executor.execute('selection.set', selectTrackPayload(trackId))
  }

  const handleTrackLaneClick = (e: React.MouseEvent, trackId: string) => {
    if (activeTool === 'pencil') {
      if (!timelineRef.current) return
      const rect = timelineRef.current.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickBeat = Math.max(0, projection.pixelToBeat(clickX))
      const snappedClick = snapBeat(clickBeat)

      void tienda.executor.execute('clip.create', {
        pistaId: trackId,
        nombre: 'Nuevo Clip Audio',
        inicio: snappedClick,
        duracion: 16,
      })
      selectTrack(trackId)
    } else {
      selectTrack(trackId)
    }
  }

  const beatToPixel = projection.beatToPixel
  const getPlayheadSeconds = useCallback(() => getPositionMs() / 1000, [getPositionMs])

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
      <TrackContextMenu
        menu={trackMenu}
        onClose={() => setTrackMenu(null)}
        tienda={tienda}
        onRequestDelete={handleDeleteTrack}
        onImportAudio={(trackId) => {
          setImportTargetTrack(trackId)
          addTrackFileRef.current?.click()
        }}
        trackIndex={
          trackMenu
            ? tracks.findIndex((t) => t.id === trackMenu.trackId)
            : -1
        }
        trackCount={tracks.length}
      />
      <ClipContextMenu menu={clipMenu} onClose={() => setClipMenu(null)} tienda={tienda} />
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
      <ArrangeBoard
        tracksHeight={tracksHeight}
        contentWidth={contentWidth}
        scrollRef={lanesScrollRef}
        extraRef={timelineRef}
        onScroll={syncFromLanes}
        onPointerMove={(e) => {
            if (lanesScrollRef.current) {
              lastPointerXRef.current =
                e.clientX - lanesScrollRef.current.getBoundingClientRect().left
            }
            handleTimelinePointerMove(e)
          }}
        onPointerUp={handleTimelinePointerUp}
        onPointerLeave={() => {}}
        onWheel={handleZoom}
        headerToolbar={(
          <>

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
              const beat = Math.max(0, ((getPositionMs() / 1000) * bpm) / 60)
              void tienda.executor.execute('marker.create', {
                nombre: `Marcador ${Math.floor(beat / beatsPerBar) + 1}`,
                tiempo: beat,
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
        
          </>
        )}
        ruler={(
          <div
            ref={rulerScrollRef}
            className="jw-scroll-hide-x h-full overflow-x-hidden overflow-y-hidden"
          >
            <div
              className="relative cursor-pointer select-none"
              style={{ width: `${contentWidth}px`, height: HEADER_H, minWidth: '100%' }}
              onClick={handleSeek}
            >
              <TimelineRuler
                projection={viewProjection}
                zoom={zoom}
                totalHeight={HEADER_H}
                bpm={bpm}
                beatsPerBar={beatsPerBar}
                viewportWidth={viewportWidth}
                height={HEADER_H}
              />
              <PlayheadOverlay
                getSeconds={getPlayheadSeconds}
                bpm={bpm}
                beatToPixel={beatToPixel}
                onPointerDown={handlePlayheadPointerDown}
              />
            </div>
          </div>
        )}
        headers={(
          <>
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
          {tracks.map((track, trackIndex) => {
            const t = toggles[track.id] ?? {
              muted: false,
              solo: false,
              input: false,
              armed: false,
            }
            const isSelected = selectedTrackId === track.id
            const isMidi = track.tipo === 'midi' || track.tipo === 'instrumento'
            const isDragOver = dragOverTrackId === track.id && dragTrackId !== track.id
            return (
              <div
                key={track.id}
                role="button"
                tabIndex={0}
                onClick={() => selectTrack(track.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  openTrackMenu(track.id, e.clientX, e.clientY)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    selectTrack(track.id)
                  }
                }}
                onDragOver={(e) => {
                  if (!dragTrackId || dragTrackId === track.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverTrackId(track.id)
                }}
                onDragLeave={() => {
                  if (dragOverTrackId === track.id) setDragOverTrackId(null)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/jaswave-track-id') || dragTrackId
                  setDragOverTrackId(null)
                  setDragTrackId(null)
                  if (!id || id === track.id) return
                  moveTrackToIndex(id, trackIndex)
                }}
                className={`flex cursor-pointer items-stretch gap-1 border-b border-border bg-panel pr-1 ${
                  isSelected ? 'bg-accent-amber/20' : 'hover:bg-panel-raised'
                } ${isDragOver ? 'ring-1 ring-inset ring-accent-amber' : ''} ${
                  dragTrackId === track.id ? 'opacity-60' : ''
                }`}
                style={{ height: rowH }}
              >
                <span
                  className="h-full w-1 shrink-0"
                  style={{ backgroundColor: track.color }}
                />
                <button
                  type="button"
                  draggable
                  aria-label={`Reordenar ${track.name}`}
                  title="Arrastrar para reordenar"
                  className="flex shrink-0 cursor-grab items-center self-stretch px-0.5 text-muted-foreground active:cursor-grabbing hover:text-foreground"
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => {
                    e.stopPropagation()
                    e.dataTransfer.setData('text/jaswave-track-id', track.id)
                    e.dataTransfer.effectAllowed = 'move'
                    setDragTrackId(track.id)
                  }}
                  onDragEnd={() => {
                    setDragTrackId(null)
                    setDragOverTrackId(null)
                  }}
                >
                  <GripVertical className="size-3.5" />
                </button>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <Mic2 className="size-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                      {track.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
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
                      label={`Monitor de entrada ${track.name}`}
                      active={t.input}
                      activeClass="bg-accent-cyan text-background"
                      onClick={() => toggle(track.id, 'input')}
                    >
                      <Headphones className="size-2.5" />
                    </TrackButton>
                    <TrackAddPluginButton trackId={track.id} trackName={track.name} />
                  </div>
                  {(isMidi || track.tipo === 'audio') ? (
                    <TrackMidiInput trackId={track.id} assignedId={track.entrada} compact />
                  ) : null}
                  {track.tipo === 'audio' ? (
                    <TrackAudioInput trackId={track.id} assignedId={track.dispositivoEntrada} compact />
                  ) : null}
                  <ChannelFxBank
                    trackId={track.id}
                    trackName={track.name}
                    plugins={track.plugins ?? []}
                    compact
                  />
                </div>
                <div className="flex flex-col items-center justify-center gap-0.5" onClick={(e) => e.stopPropagation()}>
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
                    onClick={(e) => {
                      e.stopPropagation()
                      openTrackMenu(track.id, e.clientX, e.clientY)
                    }}
                    aria-label={`Opciones ${track.name}`}
                    aria-haspopup="menu"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <MoreVertical className="size-4" />
                  </button>
                </div>
              </div>
            )
          })}

          </>
        )}
        lanes={(
          <>
            <div
              className="relative cursor-pointer"
              data-track-area
              style={{ height: tracksHeight }}
              onPointerDown={(e) => {
                if (e.button === 2) beginClipRightDrag(e)
              }}
              onContextMenu={(e) => e.preventDefault()}
            >
              <GridLayer
                projection={viewProjection}
                zoom={zoom}
                beatsPerBar={beatsPerBar}
                viewportWidth={viewportWidth}
                contentHeight={tracksHeight}
              />

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

            <PlayheadOverlay
              getSeconds={getPlayheadSeconds}
              bpm={bpm}
              beatToPixel={beatToPixel}
              showTooltip={dragging && Boolean(playheadTooltip)}
              tooltipLabel={
                playheadTooltip ? `${playheadTooltip.bar}.${playheadTooltip.beatInBar}` : undefined
              }
              onPointerDown={handlePlayheadPointerDown}
            />

            {clipLasso ? (
              <div
                className="pointer-events-none absolute z-30 border border-accent-amber bg-accent-amber/15"
                style={{
                  left: Math.min(clipLasso.x0, clipLasso.x1),
                  top: Math.min(clipLasso.y0, clipLasso.y1),
                  width: Math.abs(clipLasso.x1 - clipLasso.x0),
                  height: Math.abs(clipLasso.y1 - clipLasso.y0),
                }}
              />
            ) : null}

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
                  } ${selectedTrackId === track.id ? 'bg-accent-amber/10' : ''}`}
                  style={{ height: rowH }}
                  onClick={(e) => handleTrackLaneClick(e, track.id)}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest('[data-clip-id]')) return
                    e.preventDefault()
                    e.stopPropagation()
                    openTrackMenu(track.id, e.clientX, e.clientY)
                  }}
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
                      style={{ height: rowH }}
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
                      const isSelected = selectedClipIds.includes(clip.id)
                      const barStart = Math.floor(inicio / beatsPerBar) + 1
                      const barEnd = Math.ceil((inicio + duracion) / beatsPerBar)
                      const barCount = barEnd - barStart + 1

                      return (
                        <div
                          key={clip.id}
                          data-clip-id={clip.id}
                          data-track-id={clip.trackId}
                          onPointerDown={(e) => {
                            if (e.button === 2) return
                            handleClipPointerDown(e, clip, clip.trackId)
                          }}
                          onContextMenu={(e) => e.preventDefault()}
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
                            style={{ height: rowH - 22 }}
                          >
                            {clip.kind === 'midi' ? (
                              <MidiClipPreview
                                notes={clip.notes ?? []}
                                durationBeats={Math.max(0.25, clip.duracionBeats)}
                                color={track.color}
                              />
                            ) : (
                              <StereoWaveform
                                waveform={clip.waveform}
                                sourceId={clip.sourceId}
                                color={track.color}
                                width={Math.max(8, clipWidth - 8)}
                                height={rowH - 24}
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
          </>
        )}
      />
      <AutomationLanesPanel />
    </div>
    </div>
  )
}

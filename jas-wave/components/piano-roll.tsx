import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Piano, MessageSquareQuote } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { usePlaybackActions } from '@/components/playback-provider'
import type { DAWState } from '../../shared/src/types/state'
import type { MidiNote } from '../../shared/src/types/clips'
import { gridLevelsForZoom, pickZoomGridPrimary, zoomLevelRank } from '@/components/arrangement/timeline-grid-math'
import { quantizeBeats } from '../../shared/src/midi/ppq'
import { audioEngine } from '@/lib/audio-engine'
import { PianoRollCanvasNotes, shouldUseCanvasNotes } from '@/components/piano-roll-canvas-notes'
import { PianoRollExpressionLanes } from '@/components/piano-roll-expression-lanes'
import { PianoRollToolbar, type PianoRollTool } from '@/components/piano-roll-toolbar'
import { PianoRollTransport, PianoRollTimelineRuler } from '@/components/piano-roll-transport'
import type { MidiClipExpression } from '../../shared/src/types/clips'
import { GROOVE_LIBRARY } from '../../shared/src/midi/groove'
import { shouldIgnoreGlobalShortcuts } from '../../shared/src'
import { getUndockUrlFocus } from '@/lib/undock-window'
import { listMidiClips, resolvePianoRollClip } from '@/src/lib/selection-helpers'
import {
  routeMidiToTrack,
  routeMidiToActiveVst,
  setPreferredVstPreviewTrack,
} from '@/src/lib/plugin/vst-voice-router'
import { allNotesOffSlot, getLoadedInstrumentForTrack } from '@/src/lib/plugin/track-vst-runtime'
import { setEditorPreviewTrackId } from '@/src/lib/plugin/editor-preview-focus'
import {
  buildMidiNotesAnchor,
  dispatchAskAiAboutSelection,
  setMusicalSelectionAnchor,
} from '@/src/lib/ai-selection-context'
import { countDuplicateMidiNotes, dedupeMidiNotes } from '@/src/lib/midi-note-dedupe'
import {
  getMidiProposalOverlay,
  subscribeMidiProposal,
} from '@/src/lib/ai-midi-proposal-store'
import { snapSeekBeat, resolveSnapDivision, SNAP_BAR } from '@/src/lib/timeline-snap'
import { scrollLeftKeepingBeat, nextPxPerBeat } from '@/src/lib/timeline-viewport'
import { PlayheadOverlay } from '@/components/arrangement/PlayheadOverlay'

type PianoRollProps = {
  trackId: string
  clipId: string
  embedded?: boolean
  onClose?: () => void
}

type LocalNote = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  canal?: number
  mute?: boolean
}

const KEY_H_BASE = 14
const LOWEST = 24
const HIGHEST = 96
const KEYS = HIGHEST - LOWEST + 1
/** Altura de la regla temporal — debe coincidir con PianoRollTimelineRuler. */
const RULER_H = 22
const KEYS_W_MIN = 48
const KEYS_W_MAX = 160
const KEYS_W_DEFAULT = 72

function noteName(pitch: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}

function isBlack(pitch: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitch % 12)
}

export function PianoRoll({ trackId, clipId, embedded = false }: PianoRollProps) {
  const tienda = useDAW()
  const clip = useDAWState((s: DAWState) => {
    const tr = s.project.tracks.find((t) => t.id === trackId)
    return tr?.clips?.find((x: { id: string }) => x.id === clipId) as
      | {
          tipo?: string
          nombre?: string
          duracion?: number
          notas?: MidiNote[]
          inicio?: number
          expression?: MidiClipExpression
        }
      | undefined
  })
  const bpm = useDAWState((s: DAWState) => s.project?.bpm?.valor ?? 120)
  const beatsPerBar = useDAWState((s: DAWState) => s.project?.timeSignature?.numerador ?? 4)
  const isPlaying = useDAWState((s: DAWState) => s.transport?.reproduciendo === true)
  const { getPositionMs, seekToBeats } = usePlaybackActions()

  const [notes, setNotes] = useState<LocalNote[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [midiProposal, setMidiProposal] = useState(() => getMidiProposalOverlay())
  useEffect(() => subscribeMidiProposal(() => setMidiProposal(getMidiProposalOverlay())), [])
  const [dirty, setDirty] = useState(false)
  const [heldKey, setHeldKey] = useState<number | null>(null)
  const [pxPerBeat, setPxPerBeat] = useState(48)
  const [keyH, setKeyH] = useState(KEY_H_BASE)
  const [keysWidth, setKeysWidth] = useState(KEYS_W_DEFAULT)
  const [viewportBeats, setViewportBeats] = useState(32)
  const projectSnapValor = useDAWState((s: DAWState) => s.project?.timeline?.snapValor ?? 1)
  const projectSnapOn = useDAWState((s: DAWState) => s.project?.timeline?.snap ?? true)
  const playheadSnap = useDAWState((s: DAWState) => s.ui?.playheadSnap !== false)
  const resolvedSnap = resolveSnapDivision(projectSnapValor, beatsPerBar)
  const snapOn = projectSnapOn && resolvedSnap > 0
  const snapDiv = resolvedSnap > 0 ? resolvedSnap : 0.25
  const setSnapOn = useCallback(
    (on: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof on === 'function' ? on(snapOn) : on
      void tienda.executor.execute('timeline.setSnap', {
        snap: next,
        snapValor: next
          ? projectSnapValor === SNAP_BAR || projectSnapValor > 0
            ? projectSnapValor
            : 0.25
          : projectSnapValor,
      })
    },
    [tienda, snapOn, projectSnapValor],
  )
  const setSnapDiv = useCallback(
    (div: number | ((prev: number) => number)) => {
      const next = typeof div === 'function' ? div(projectSnapValor) : div
      void tienda.executor.execute('timeline.setSnap', {
        snap: next === SNAP_BAR || next > 0,
        snapValor: next,
      })
    },
    [tienda, projectSnapValor],
  )
  const [showVelocity, setShowVelocity] = useState(true)
  const [showExpression, setShowExpression] = useState(true)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [herramienta, setHerramienta] = useState<PianoRollTool>('seleccionar')
  const [clipboard, setClipboard] = useState<LocalNote[]>([])
  const clipboardRef = useRef<LocalNote[]>([])
  const [soloClip, setSoloClip] = useState(false)
  /** Si true, playhead/seek del piano roll siguen el transporte del DAW. */
  const [alignTimeline, setAlignTimeline] = useState(true)
  const [followPlayhead, setFollowPlayhead] = useState(true)
  /** Playhead local (ms absolutos) cuando alignTimeline=false. */
  const [localPlayheadMs, setLocalPlayheadMs] = useState(0)
  const [quantizeMode, setQuantizeMode] = useState<'start' | 'end' | 'both'>('start')
  const [quantizeStrength, setQuantizeStrength] = useState(1)
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const useCanvas = shouldUseCanvasNotes(notes.length)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const keysScrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const syncingScrollRef = useRef(false)
  const notesRef = useRef(notes)
  const selectedRef = useRef(selectedIds)
  const pxPerBeatRef = useRef(pxPerBeat)
  const keyHRef = useRef(keyH)
  const viewDurationBeatsRef = useRef(32)
  notesRef.current = notes
  selectedRef.current = selectedIds
  pxPerBeatRef.current = pxPerBeat
  keyHRef.current = keyH

  const trackName = useDAWState((s: DAWState) => {
    const tr = s.project.tracks.find((t) => t.id === trackId)
    return tr?.nombre ?? trackId
  })
  const clipStartBeat = clip?.inicio ?? 0
  const trackPlugins = useDAWState((s: DAWState) => {
    const tr = s.project.tracks.find((t) => t.id === trackId)
    return tr?.plugins
  })
  const draggingRef = useRef(false)
  const alignTimelineRef = useRef(alignTimeline)
  const localPlayheadMsRef = useRef(localPlayheadMs)
  const clipStartBeatRef = useRef(clipStartBeat)
  const bpmRef = useRef(bpm)
  const followPlayheadRef = useRef(followPlayhead)
  const isPlayingRef = useRef(isPlaying)
  alignTimelineRef.current = alignTimeline
  localPlayheadMsRef.current = localPlayheadMs
  clipStartBeatRef.current = clipStartBeat
  bpmRef.current = bpm
  followPlayheadRef.current = followPlayhead
  isPlayingRef.current = isPlaying

  const getPlayheadAbsBeat = useCallback(() => {
    const sourceMs = alignTimelineRef.current ? getPositionMs() : localPlayheadMsRef.current
    return Math.max(0, (sourceMs / 1000) * (bpmRef.current / 60))
  }, [getPositionMs])

  const seekAbsBeats = useCallback(
    (absBeats: number) => {
      const snapped = snapSeekBeat(absBeats, {
        playheadSnap,
        snapEnabled: projectSnapOn,
        snapValor: projectSnapValor,
        beatsPerBar,
      })
      if (alignTimelineRef.current) {
        seekToBeats(snapped)
      } else {
        const sec = (snapped * 60) / Math.max(1, bpmRef.current)
        setLocalPlayheadMs(sec * 1000)
      }
    },
    [playheadSnap, projectSnapOn, projectSnapValor, beatsPerBar, seekToBeats],
  )

  /** Zoom H anclado al playhead (paridad arrange). */
  const zoomHorizontalAtPlayhead = useCallback(
    (zoomIn: boolean) => {
      const scroll = scrollRef.current
      const prev = pxPerBeatRef.current
      const next = nextPxPerBeat(prev, zoomIn)
      if (Math.abs(next - prev) < 0.05) return
      const absBeat = getPlayheadAbsBeat()
      const relBeat = absBeat - clipStartBeatRef.current
      pxPerBeatRef.current = next
      setPxPerBeat(next)
      if (scroll) {
        const viewX = relBeat * prev - scroll.scrollLeft
        requestAnimationFrame(() => {
          scroll.scrollLeft = scrollLeftKeepingBeat(relBeat, next, viewX)
        })
      }
    },
    [getPlayheadAbsBeat],
  )

  const panTimelinePx = useCallback((deltaPx: number) => {
    const scroll = scrollRef.current
    if (!scroll || !Number.isFinite(deltaPx) || deltaPx === 0) return
    scroll.scrollLeft = Math.max(0, scroll.scrollLeft + deltaPx)
  }, [])

  const syncSelectionAnchor = useCallback(() => {
    if (selectedIds.size === 0) {
      setMusicalSelectionAnchor(null)
      return
    }
    const selected = notes.filter((n) => selectedIds.has(n.id))
    if (!selected.length) {
      setMusicalSelectionAnchor(null)
      return
    }
    setMusicalSelectionAnchor(
      buildMidiNotesAnchor({
        trackId,
        trackName,
        clipId,
        clipName: String(clip?.nombre ?? 'Clip'),
        notes: selected.map((n) => ({
          id: n.id,
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
          canal: n.canal,
        })),
      }),
    )
  }, [selectedIds, notes, trackId, trackName, clipId, clip?.nombre])

  useEffect(() => {
    syncSelectionAnchor()
  }, [syncSelectionAnchor])

  const askAiAboutSelection = useCallback(() => {
    syncSelectionAnchor()
    if (selectedRef.current.size === 0) return
    dispatchAskAiAboutSelection()
  }, [syncSelectionAnchor])

  useEffect(() => {
    if (!clip || clip.tipo !== 'midi') return
    // No pisar edición local (drag / inspector) con el store.
    if (dirty || draggingRef.current) return
    setNotes(
      (() => {
        const seen = new Set<string>()
        const out: LocalNote[] = []
        for (const n of clip.notas ?? []) {
          if (!n?.id || seen.has(n.id)) continue
          seen.add(n.id)
          out.push({
            id: n.id,
            pitch: n.pitch,
            inicio: n.inicio,
            duracion: n.duracion,
            velocidad: n.velocidad,
            canal: n.canal,
            mute: n.mute,
          })
        }
        return out
      })(),
    )
  }, [clip, clipId, trackId, dirty])

  useEffect(() => {
    setPreferredVstPreviewTrack(trackId, trackPlugins)
    setEditorPreviewTrackId(trackId)
    const hit = trackPlugins?.find((p) => !p.bypass)
    if (hit) {
      void import('@/src/lib/plugin/track-vst-runtime').then(
        ({ ensureTrackVstInstrument, findTrackPlaybackInstrument }) => {
          const play = findTrackPlaybackInstrument(trackPlugins)
          if (play?.kind === 'vst' && play.plugin) {
            void ensureTrackVstInstrument(trackId, play.plugin)
          } else if (play?.kind !== 'builtin') {
            void ensureTrackVstInstrument(trackId, hit)
          }
        },
      )
    }
    return () => {
      setEditorPreviewTrackId(null)
    }
  }, [trackId, trackPlugins])

  useEffect(() => () => audioEngine.allNotesOff(), [])

  const heldAuditionRef = useRef<Set<number>>(new Set())
  const tapTimersRef = useRef<Map<number, number>>(new Map())
  const maxHoldTimerRef = useRef<number | null>(null)

  const releaseNote = useCallback(
    (pitch: number) => {
      const t = tapTimersRef.current.get(pitch)
      if (t != null) {
        window.clearTimeout(t)
        tapTimersRef.current.delete(pitch)
      }
      if (!routeMidiToTrack(trackId, false, pitch, 0, { ignoreMute: true, plugins: trackPlugins })) {
        routeMidiToActiveVst(false, pitch, 0, { ignoreMute: true })
      }
      heldAuditionRef.current.delete(pitch)
    },
    [trackId, trackPlugins],
  )

  const releaseAllAudition = useCallback(() => {
    const pitches = [...heldAuditionRef.current]
    heldAuditionRef.current.clear()
    for (const p of pitches) {
      const t = tapTimersRef.current.get(p)
      if (t != null) {
        window.clearTimeout(t)
        tapTimersRef.current.delete(p)
      }
      if (!routeMidiToTrack(trackId, false, p, 0, { ignoreMute: true, plugins: trackPlugins })) {
        routeMidiToActiveVst(false, p, 0, { ignoreMute: true })
      }
    }
    for (const t of tapTimersRef.current.values()) window.clearTimeout(t)
    tapTimersRef.current.clear()
    if (maxHoldTimerRef.current != null) {
      window.clearTimeout(maxHoldTimerRef.current)
      maxHoldTimerRef.current = null
    }
    const loaded = getLoadedInstrumentForTrack(trackId)
    if (loaded?.slotId) allNotesOffSlot(loaded.slotId)
  }, [trackId, trackPlugins])

  const previewNote = useCallback(
    (pitch: number, velocity = 100) => {
      // Re-trigger limpio: evita voices apiladas del mismo pitch.
      if (heldAuditionRef.current.has(pitch)) releaseNote(pitch)
      heldAuditionRef.current.add(pitch)
      if (
        !routeMidiToTrack(trackId, true, pitch, velocity, {
          ignoreMute: true,
          plugins: trackPlugins,
        })
      ) {
        routeMidiToActiveVst(true, pitch, velocity, { ignoreMute: true })
      }
      // Failsafe si se pierde pointerup (undock, captura, blur).
      if (maxHoldTimerRef.current != null) window.clearTimeout(maxHoldTimerRef.current)
      maxHoldTimerRef.current = window.setTimeout(() => {
        maxHoldTimerRef.current = null
        releaseAllAudition()
      }, 8000)
    },
    [trackId, trackPlugins, releaseNote, releaseAllAudition],
  )

  /** Click corto: noteOn + noteOff programado (no depende solo de pointerup). */
  const tapAudition = useCallback(
    (pitch: number, velocity = 100, ms = 200) => {
      previewNote(pitch, velocity)
      const prev = tapTimersRef.current.get(pitch)
      if (prev != null) window.clearTimeout(prev)
      tapTimersRef.current.set(
        pitch,
        window.setTimeout(() => {
          tapTimersRef.current.delete(pitch)
          releaseNote(pitch)
        }, ms),
      )
    },
    [previewNote, releaseNote],
  )

  const previewNoteRef = useRef(previewNote)
  const releaseNoteRef = useRef(releaseNote)
  const releaseAllAuditionRef = useRef(releaseAllAudition)
  const tapAuditionRef = useRef(tapAudition)
  previewNoteRef.current = previewNote
  releaseNoteRef.current = releaseNote
  releaseAllAuditionRef.current = releaseAllAudition
  tapAuditionRef.current = tapAudition
  const heldKeyRef = useRef<number | null>(null)

  useEffect(() => () => releaseAllAuditionRef.current(), [])
  useEffect(() => {
    const onBlur = () => releaseAllAuditionRef.current()
    const onVis = () => {
      if (document.hidden) releaseAllAuditionRef.current()
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  /** Glissando estilo REAPER en el teclado virtual (mantener clic y arrastrar). */
  const onKeyboardPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const root = e.currentTarget
    root.setPointerCapture(e.pointerId)
    const rect = root.getBoundingClientRect()
    const y = e.clientY - rect.top
    const pitch = Math.max(LOWEST, Math.min(HIGHEST, HIGHEST - Math.floor(y / keyH)))
    heldKeyRef.current = pitch
    setHeldKey(pitch)
    previewNoteRef.current(pitch, 110)
  }
  const onKeyboardPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (heldKeyRef.current == null) return
    if (!(e.buttons & 1)) {
      const p = heldKeyRef.current
      heldKeyRef.current = null
      setHeldKey(null)
      if (p != null) releaseNoteRef.current(p)
      return
    }
    const root = e.currentTarget
    const rect = root.getBoundingClientRect()
    const y = e.clientY - rect.top
    const pitch = Math.max(LOWEST, Math.min(HIGHEST, HIGHEST - Math.floor(y / keyH)))
    if (pitch === heldKeyRef.current) return
    releaseNoteRef.current(heldKeyRef.current)
    heldKeyRef.current = pitch
    setHeldKey(pitch)
    previewNoteRef.current(pitch, 110)
  }
  const onKeyboardPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    const p = heldKeyRef.current
    heldKeyRef.current = null
    setHeldKey(null)
    if (p != null) releaseNoteRef.current(p)
  }

  useEffect(() => {
    void audioEngine.armNativeMixOutput()
  }, [])

  /** Rueda = zoom/pan como arrange. Ctrl+Shift = zoom vertical teclas.
   *  Capture en window: en undock Chromium intercepta Ctrl+rueda como zoom de página. */
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const root = rootRef.current
      if (!root) return
      const target = e.target
      if (!(target instanceof Node) || !root.contains(target)) return
      if (target instanceof Element && target.closest('[data-expression-lanes]')) return
      // Sobre el teclado: rueda sin modificador = scroll vertical nativo
      if (
        target instanceof Element &&
        target.closest('[data-piano-keys]') &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        return
      }

      const scroll = scrollRef.current
      const ctrl = e.ctrlKey || e.metaKey
      const shift = e.shiftKey

      // Ctrl+Shift → zoom vertical teclas (ancla pitch bajo cursor)
      if (ctrl && shift) {
        e.preventDefault()
        e.stopPropagation()
        const factor = Math.exp(-e.deltaY * 0.0025)
        const prev = keyHRef.current
        const next = Math.min(28, Math.max(8, Math.round(prev * factor * 10) / 10))
        if (next === prev) return
        if (!scroll) {
          keyHRef.current = next
          setKeyH(next)
          return
        }
        const rect = scroll.getBoundingClientRect()
        const mouseY = e.clientY - rect.top - RULER_H
        const contentY = scroll.scrollTop + Math.max(0, mouseY)
        const ratio = contentY / Math.max(1, prev * KEYS)
        keyHRef.current = next
        setKeyH(next)
        requestAnimationFrame(() => {
          scroll.scrollTop = Math.max(0, ratio * next * KEYS - Math.max(0, mouseY))
        })
        return
      }

      // Shift sin Ctrl → pan horizontal
      if (shift && !ctrl) {
        e.preventDefault()
        e.stopPropagation()
        const deltaPx = e.deltaY !== 0 ? e.deltaY : e.deltaX
        if (scroll && Number.isFinite(deltaPx) && deltaPx !== 0) {
          scroll.scrollLeft = Math.max(0, scroll.scrollLeft + deltaPx)
        }
        return
      }

      // Trackpad pan H nativo: dejar pasar
      if (!ctrl && Math.abs(e.deltaY) < 0.5 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return
      }

      // Rueda o Ctrl+rueda → zoom H anclado al playhead
      e.preventDefault()
      e.stopPropagation()
      const zoomIn = e.deltaY < 0 || (e.deltaY === 0 && e.deltaX < 0)
      const absDy = Math.abs(e.deltaY) || Math.abs(e.deltaX) || 100
      const ticks = Math.min(4, Math.max(1, Math.round(absDy / 80)))
      for (let i = 0; i < ticks; i++) zoomHorizontalAtPlayhead(zoomIn)
    }
    window.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [zoomHorizontalAtPlayhead])

  const clipDurationBeats = useMemo(() => {
    const fromNotes = notes.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4)
    return Math.max(clip?.duracion ?? 4, fromNotes, 4)
  }, [notes, clip?.duracion])

  /** Timeline extendida más allá del clip para ver rejilla y playhead de la canción. */
  const viewDurationBeats = useMemo(() => {
    const pad = Math.max(beatsPerBar * 8, viewportBeats + beatsPerBar * 2)
    return Math.max(clipDurationBeats + beatsPerBar * 4, pad, clipDurationBeats + 1)
  }, [clipDurationBeats, viewportBeats, beatsPerBar])
  viewDurationBeatsRef.current = viewDurationBeats

  // Medir beats visibles del viewport para extender la rejilla.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => {
      const ppb = Math.max(1, pxPerBeatRef.current)
      setViewportBeats(Math.max(8, el.clientWidth / ppb))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pxPerBeat])

  /** Follow playhead + sync scroll vertical teclas↔grid (RAF estable vía refs). */
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const scroll = scrollRef.current
      if (scroll && followPlayheadRef.current && alignTimelineRef.current && isPlayingRef.current) {
        const sourceMs = getPositionMs()
        const absBeats = (sourceMs / 1000) * (bpmRef.current / 60)
        const rel = absBeats - clipStartBeatRef.current
        const x = rel * pxPerBeatRef.current
        const viewL = scroll.scrollLeft
        const viewR = viewL + scroll.clientWidth
        const margin = scroll.clientWidth * 0.15
        if (x >= -8 && x <= viewDurationBeatsRef.current * pxPerBeatRef.current + 8) {
          if (x < viewL + margin || x > viewR - margin) {
            scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3)
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPositionMs])

  const syncVerticalFromGrid = useCallback(() => {
    if (syncingScrollRef.current) return
    const scroll = scrollRef.current
    const keys = keysScrollRef.current
    if (!scroll || !keys) return
    syncingScrollRef.current = true
    keys.scrollTop = scroll.scrollTop
    requestAnimationFrame(() => {
      syncingScrollRef.current = false
    })
  }, [])

  const syncVerticalFromKeys = useCallback(() => {
    if (syncingScrollRef.current) return
    const scroll = scrollRef.current
    const keys = keysScrollRef.current
    if (!scroll || !keys) return
    syncingScrollRef.current = true
    scroll.scrollTop = keys.scrollTop
    requestAnimationFrame(() => {
      syncingScrollRef.current = false
    })
  }, [])

  const beginKeysResize = useCallback((e: ReactPointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = keysWidth
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(KEYS_W_MAX, Math.max(KEYS_W_MIN, startW + (ev.clientX - startX)))
      setKeysWidth(next)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [keysWidth])

  const getPlayheadSeconds = useCallback(() => {
    const ms = alignTimelineRef.current ? getPositionMs() : localPlayheadMsRef.current
    return Math.max(0, ms / 1000)
  }, [getPositionMs])

  const beatToPianoPixel = useCallback(
    (absBeat: number) => (absBeat - clipStartBeatRef.current) * pxPerBeatRef.current,
    [],
  )

  const onPlayheadPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const scroll = scrollRef.current
      if (!scroll) return
      const seekFromClientX = (clientX: number) => {
        const rect = scroll.getBoundingClientRect()
        const x = clientX - rect.left + scroll.scrollLeft
        const rel = Math.max(0, x / pxPerBeatRef.current)
        seekAbsBeats(clipStartBeatRef.current + rel)
      }
      seekFromClientX(e.clientX)
      const onMove = (ev: PointerEvent) => seekFromClientX(ev.clientX)
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [seekAbsBeats],
  )

  const gridWidth = viewDurationBeats * pxPerBeat
  const gridHeight = KEYS * keyH
  const gridLines = useMemo(() => {
    const depth = snapOn ? snapDiv : 0
    const all = gridLevelsForZoom(pxPerBeat, beatsPerBar, depth)
    return all.filter((l) => viewDurationBeats / l.spacingBeats <= 512)
  }, [pxPerBeat, viewDurationBeats, beatsPerBar, snapOn, snapDiv])
  const zoomPrimary = useMemo(
    () => pickZoomGridPrimary(pxPerBeat, beatsPerBar, snapOn ? snapDiv : 0),
    [pxPerBeat, beatsPerBar, snapOn, snapDiv],
  )

  const snapBeat = useCallback(
    (beats: number) => (snapOn ? Math.max(0, quantizeBeats(beats, snapDiv, 1)) : Math.max(0, beats)),
    [snapOn, snapDiv],
  )

  const persist = useCallback(
    async (next: LocalNote[]) => {
      try {
        await tienda.executor.execute('midi.notes.set', {
          pistaId: trackId,
          clipId,
          notas: next.map((n) => ({
            id: n.id,
            pitch: n.pitch,
            inicio: n.inicio,
            duracion: n.duracion,
            velocidad: n.velocidad,
            canal: n.canal ?? 0,
            ...(n.mute !== undefined ? { mute: n.mute } : {}),
          })),
          duracion: Math.max(
            clip?.duracion ?? 4,
            next.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4),
          ),
        })
        setDirty(false)
      } finally {
        draggingRef.current = false
      }
    },
    [tienda, trackId, clipId, clip?.duracion],
  )

  /** Arrastre de notas (individual o grupo) con pointer capture; no pisa el store hasta soltar.
   *  Alt = sin imán. Ctrl/Cmd + cuerpo = duplicar (Reaper). Clic Ctrl sin mover = toggle selección. */
  const beginNoteDrag = useCallback(
    (
      ev: Pick<
        PointerEvent,
        'clientX' | 'clientY' | 'pointerId' | 'target' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'
      >,
      hitId: string,
      edge: false | 'start' | 'end',
      previewPitch: number,
      previewVel: number,
    ) => {
      if (herramienta === 'borrar') return
      const wantDuplicate = !edge && (ev.ctrlKey || ev.metaKey) && !ev.altKey
      const sourceIds =
        selectedIds.has(hitId) && selectedIds.size > 0 ? selectedIds : new Set([hitId])
      if (!wantDuplicate) {
        setSelectedIds(sourceIds)
      }
      draggingRef.current = true
      let lastAuditionPitch = previewPitch
      let ended = false
      let duplicated = false
      let dragIds = sourceIds
      let primaryId = hitId
      if (!wantDuplicate) setDirty(true)
      previewNoteRef.current(previewPitch, Math.max(previewVel, 100))

      const startX = ev.clientX
      const startY = ev.clientY
      const freeMove = Boolean(ev.altKey)
      const fineMove = Boolean(ev.shiftKey)
      const MOVE_PX = 3
      const origins = new Map(
        notesRef.current.filter((x) => sourceIds.has(x.id)).map((x) => [x.id, { ...x }]),
      )

      const quantOrFree = (beats: number) => {
        if (freeMove) return Math.max(0, beats)
        if (fineMove) return Math.max(0, quantizeBeats(beats, snapDiv / 4, 1))
        return snapBeat(beats)
      }

      const ensureDuplicates = () => {
        if (!wantDuplicate || duplicated) return
        duplicated = true
        setDirty(true)
        const stamp = Date.now()
        const copies: LocalNote[] = []
        const nextOrigins = new Map<string, LocalNote>()
        let nextPrimary = primaryId
        for (const id of sourceIds) {
          const o = origins.get(id)
          if (!o) continue
          const copy: LocalNote = {
            ...o,
            id: `n-${stamp}-${Math.random().toString(36).slice(2, 6)}`,
          }
          copies.push(copy)
          nextOrigins.set(copy.id, { ...copy })
          if (id === hitId) nextPrimary = copy.id
        }
        origins.clear()
        for (const [id, o] of nextOrigins) origins.set(id, o)
        dragIds = new Set(copies.map((c) => c.id))
        primaryId = nextPrimary
        setNotes((prev) => [...prev, ...copies])
        setSelectedIds(dragIds)
      }

      const target = ev.target as HTMLElement | null
      const pointerId = ev.pointerId
      try {
        target?.setPointerCapture?.(pointerId)
      } catch {
        /* ignore */
      }

      const move = (e2: PointerEvent) => {
        const dx = e2.clientX - startX
        const dy = e2.clientY - startY
        if (wantDuplicate && !duplicated) {
          if (Math.hypot(dx, dy) < MOVE_PX) return
          ensureDuplicates()
        }
        const pitchStep = fineMove ? Math.round(dy / (keyH * 2)) : Math.round(dy / keyH)
        setNotes((prev) =>
          prev.map((x) => {
            const o = origins.get(x.id)
            if (!o) return x
            if (edge === 'end') {
              const raw = o.duracion + dx / pxPerBeat
              return {
                ...x,
                duracion: Math.max(
                  snapDiv / 4,
                  freeMove ? Math.max(0.01, raw) : quantOrFree(raw),
                ),
              }
            }
            if (edge === 'start') {
              const rawInicio = o.inicio + dx / pxPerBeat
              const newInicio = freeMove ? Math.max(0, rawInicio) : quantOrFree(rawInicio)
              const end = o.inicio + o.duracion
              const minDur = snapDiv / 4
              return {
                ...x,
                inicio: Math.min(newInicio, end - minDur),
                duracion: Math.max(minDur, end - Math.min(newInicio, end - minDur)),
              }
            }
            const nextPitch = Math.max(LOWEST, Math.min(HIGHEST, o.pitch - pitchStep))
            return {
              ...x,
              inicio: quantOrFree(o.inicio + dx / pxPerBeat),
              pitch: nextPitch,
            }
          }),
        )
        if (!edge) {
          const primary = origins.get(primaryId)
          if (primary) {
            const nextPitch = Math.max(LOWEST, Math.min(HIGHEST, primary.pitch - pitchStep))
            if (nextPitch !== lastAuditionPitch) {
              releaseNoteRef.current(lastAuditionPitch)
              lastAuditionPitch = nextPitch
              previewNoteRef.current(nextPitch, Math.max(previewVel, 100))
            }
          }
        }
      }
      const up = () => {
        if (ended) return
        ended = true
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        target?.removeEventListener?.('lostpointercapture', up)
        try {
          target?.releasePointerCapture?.(pointerId)
        } catch {
          /* ignore */
        }
        releaseNoteRef.current(lastAuditionPitch)
        releaseAllAuditionRef.current()
        if (wantDuplicate && !duplicated) {
          // Ctrl/Cmd + clic sin mover: toggle selección (como antes)
          draggingRef.current = false
          setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(hitId)) next.delete(hitId)
            else next.add(hitId)
            return next
          })
          return
        }
        setNotes((prev) => {
          void persist(prev)
          return prev
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      target?.addEventListener?.('lostpointercapture', up)
    },
    [herramienta, selectedIds, snapDiv, snapBeat, pxPerBeat, keyH, persist],
  )

  const addNoteAt = (clientX: number, clientY: number, gridEl: HTMLDivElement, dragDur = false) => {
    // getBoundingClientRect ya refleja el scroll; no sumar scrollLeft/Top.
    const rect = gridEl.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const inicio = snapBeat(x / pxPerBeat)
    const pitch = Math.max(LOWEST, Math.min(HIGHEST, HIGHEST - Math.floor(y / keyH)))
    const note: LocalNote = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pitch,
      inicio,
      duracion: snapDiv,
      velocidad: 90,
    }
    tapAudition(pitch, 90, 220)
    if (dragDur) {
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - clientX
        note.duracion = Math.max(snapDiv, snapBeat(snapDiv + dx / pxPerBeat))
        setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...note } : n)))
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setNotes((prev) => {
          void persist(prev)
          return prev
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
    const next = [...notes, note]
    setNotes(next)
    setSelectedIds(new Set([note.id]))
    setDirty(true)
    if (!dragDur) void persist(next)
  }

  const deleteSelected = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size === 0) return
    const next = notesRef.current.filter((n) => !ids.has(n.id))
    setNotes(next)
    setSelectedIds(new Set())
    setDirty(true)
    void persist(next)
  }, [persist])

  const transposeSelected = useCallback(
    (semi: number) => {
      const ids = selectedRef.current
      if (ids.size === 0) return
      const next = notesRef.current.map((n) =>
        ids.has(n.id)
          ? { ...n, pitch: Math.max(LOWEST, Math.min(HIGHEST, n.pitch + semi)) }
          : n,
      )
      setNotes(next)
      setDirty(true)
      void persist(next)
    },
    [persist],
  )

  const nudgeSelected = useCallback(
    (deltaBeats: number) => {
      const ids = selectedRef.current
      if (ids.size === 0) return
      const next = notesRef.current.map((n) =>
        ids.has(n.id) ? { ...n, inicio: Math.max(0, snapBeat(n.inicio + deltaBeats)) } : n,
      )
      setNotes(next)
      setDirty(true)
      void persist(next)
    },
    [persist, snapBeat],
  )

  const duplicateSelected = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size === 0) return
    const sel = notesRef.current.filter((n) => ids.has(n.id))
    const span =
      Math.max(...sel.map((n) => n.inicio + n.duracion)) - Math.min(...sel.map((n) => n.inicio))
    const copies = sel.map((n) => ({
      ...n,
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      inicio: n.inicio + Math.max(snapDiv, span),
    }))
    const next = [...notesRef.current, ...copies]
    setNotes(next)
    setSelectedIds(new Set(copies.map((c) => c.id)))
    setDirty(true)
    void persist(next)
  }, [persist, snapDiv])

  const quantizeSelected = useCallback(() => {
    const ids = selectedRef.current
    const noteIds = ids.size > 0 ? [...ids] : undefined
    void tienda.executor
      .execute('midi.quantize', {
        pistaId: trackId,
        clipId,
        gridBeats: snapDiv,
        strength: quantizeStrength,
        mode: quantizeMode,
        noteIds,
      })
      .catch(() => {
        const next = notesRef.current.map((n) => {
          if (ids.size > 0 && !ids.has(n.id)) return n
          return { ...n, inicio: snapBeat(n.inicio) }
        })
        setNotes(next)
        setDirty(true)
        void persist(next)
      })
  }, [tienda, trackId, clipId, snapDiv, quantizeStrength, quantizeMode, persist, snapBeat])

  const dedupeNotes = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size > 0) {
      const selected = notesRef.current.filter((n) => ids.has(n.id))
      const { kept, removedCount } = dedupeMidiNotes(selected)
      if (removedCount === 0) return
      const others = notesRef.current.filter((n) => !ids.has(n.id))
      const finalNotes = [...others, ...kept]
      setNotes(finalNotes)
      setSelectedIds(new Set(kept.map((n) => n.id)))
      setDirty(true)
      void persist(finalNotes)
      return
    }
    const { kept, removedCount } = dedupeMidiNotes(notesRef.current)
    if (removedCount === 0) return
    setNotes(kept)
    setSelectedIds(new Set())
    setDirty(true)
    void persist(kept)
  }, [persist])

  const duplicadosCount = useMemo(() => countDuplicateMidiNotes(notes), [notes])

  const scaleVelocitySelected = useCallback(
    (factor: number) => {
      const ids = selectedRef.current
      const noteIds = ids.size > 0 ? [...ids] : undefined
      void tienda.executor
        .execute('midi.setVelocity', {
          pistaId: trackId,
          clipId,
          relativeFactor: factor,
          noteIds,
        })
        .catch(() => {
          const next = notesRef.current.map((n) => {
            if (ids.size > 0 && !ids.has(n.id)) return n
            return {
              ...n,
              velocidad: Math.max(1, Math.min(127, Math.round(n.velocidad * factor))),
            }
          })
          setNotes(next)
          setDirty(true)
          void persist(next)
        })
    },
    [tienda, trackId, clipId, persist],
  )

  const setVelocitySelected = useCallback(
    (velocity: number) => {
      const ids = selectedRef.current
      const v = Math.max(1, Math.min(127, Math.round(velocity)))
      const noteIds = ids.size > 0 ? [...ids] : undefined
      void tienda.executor
        .execute('midi.setVelocity', {
          pistaId: trackId,
          clipId,
          velocity: v,
          noteIds,
        })
        .catch(() => {
          const next = notesRef.current.map((n) => {
            if (ids.size > 0 && !ids.has(n.id)) return n
            return { ...n, velocidad: v }
          })
          setNotes(next)
          setDirty(true)
          void persist(next)
        })
    },
    [tienda, trackId, clipId, persist],
  )

  const copySelected = useCallback(() => {
    const ids = selectedRef.current
    if (ids.size === 0) return
    setClipboard(notesRef.current.filter((n) => ids.has(n.id)).map((n) => ({ ...n })))
  }, [])

  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0) return
    const origin = Math.min(...clipboard.map((n) => n.inicio))
    const copies = clipboard.map((n, i) => ({
      ...n,
      id: `n-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      inicio: snapBeat(n.inicio - origin + origin + snapDiv),
    }))
    const next = [...notesRef.current, ...copies]
    setNotes(next)
    setSelectedIds(new Set(copies.map((c) => c.id)))
    setDirty(true)
    void persist(next)
  }, [clipboard, persist, snapBeat, snapDiv])

  useEffect(() => {
    clipboardRef.current = clipboard
  }, [clipboard])

  useEffect(() => {
    const isPianoContext = (): boolean => {
      try {
        if (getUndockUrlFocus().toolId === 'piano-roll') return true
      } catch {
        /* ignore */
      }
      const root = rootRef.current
      if (!root) return false
      const ae = document.activeElement
      return ae instanceof Node && root.contains(ae)
    }

    const onKey = (e: KeyboardEvent) => {
      if (shouldIgnoreGlobalShortcuts(e.target)) return

      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      const pianoCtx = isPianoContext()

      // Ctrl+C/V/X: no secuestrar si no hay notas seleccionadas / clipboard de notas.
      // Así el arrange puede copiar/pegar clips aunque el piano roll esté montado.
      if (mod && key === 'c') {
        if (!pianoCtx || selectedRef.current.size === 0) return
        e.preventDefault()
        e.stopPropagation()
        copySelected()
        return
      }
      if (mod && key === 'v') {
        if (!pianoCtx || clipboardRef.current.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        pasteClipboard()
        return
      }
      if (mod && key === 'x') {
        if (!pianoCtx || selectedRef.current.size === 0) return
        e.preventDefault()
        e.stopPropagation()
        copySelected()
        deleteSelected()
        return
      }

      // Resto de atajos del piano: solo con foco en el panel (o ventana undock)
      if (!pianoCtx) return

      if (key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
        return
      }
      if (!mod && key === 'v') {
        e.preventDefault()
        setHerramienta('seleccionar')
        return
      }
      if (!mod && (key === 'd' || key === 'b')) {
        e.preventDefault()
        setHerramienta('dibujar')
        return
      }
      if (!mod && (key === 'e' || key === 'x')) {
        e.preventDefault()
        setHerramienta('borrar')
        return
      }
      if (!mod && key === 's') {
        e.preventDefault()
        setSnapOn((v) => !v)
        return
      }
      if (!mod && key === 'q') {
        e.preventDefault()
        quantizeSelected()
        return
      }
      if (!mod && key === 'g') {
        e.preventDefault()
        setShowVelocity((v) => !v)
        return
      }
      if (!mod && key === 'f') {
        e.preventDefault()
        setShowExpression((v) => !v)
        return
      }
      if (!mod && key === 'h') {
        e.preventDefault()
        setKeyH((h) => (h >= 20 ? KEY_H_BASE : h + 3))
        return
      }
      if (!mod && (key === '+' || key === '=')) {
        e.preventDefault()
        e.stopPropagation()
        zoomHorizontalAtPlayhead(true)
        return
      }
      if (!mod && (key === '-' || key === '_')) {
        e.preventDefault()
        e.stopPropagation()
        zoomHorizontalAtPlayhead(false)
        return
      }
      if (!mod && ['1', '2', '3', '4', '5', '6', '7', '8', '0'].includes(key)) {
        e.preventDefault()
        const map: Record<string, number> = {
          '1': SNAP_BAR,
          '2': 2,
          '3': 1,
          '4': 0.5,
          '5': 0.25,
          '6': 0.125,
          '7': 0.0625,
          '8': 0.03125,
          '0': 0,
        }
        const next = map[key]
        if (next === undefined) return
        setSnapDiv(next)
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        e.stopPropagation()
        void (async () => {
          if (soloClip && alignTimeline && !isPlaying) {
            const startSec = ((clip?.inicio ?? 0) * 60) / Math.max(1, bpm)
            await tienda.executor.execute('transport.seek', { segundos: startSec })
          }
          await tienda.executor.execute('transport.toggle', {})
        })()
        return
      }
      if (!mod && (e.key === 'Home' || e.code === 'Home')) {
        e.preventDefault()
        void (async () => {
          if (alignTimeline) {
            const sec = soloClip ? ((clip?.inicio ?? 0) * 60) / Math.max(1, bpm) : 0
            await tienda.executor.execute('transport.seek', { segundos: sec })
          } else {
            setLocalPlayheadMs(((clip?.inicio ?? 0) * 60_000) / Math.max(1, bpm))
          }
        })()
        return
      }
      if (!mod && (key === 'enter' || e.code === 'Enter')) {
        e.preventDefault()
        void tienda.executor.execute('transport.stop', {})
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteSelected()
        return
      }
      if (mod && key === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(notesRef.current.map((n) => n.id)))
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        duplicateSelected()
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        transposeSelected(e.shiftKey ? 12 : 1)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        transposeSelected(e.shiftKey ? -12 : -1)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        const dir = e.key === 'ArrowLeft' ? -1 : 1
        if (selectedRef.current.size > 0) {
          nudgeSelected(dir * (e.shiftKey ? 1 : snapDiv))
        } else if (e.altKey) {
          panTimelinePx(dir * beatsPerBar * pxPerBeatRef.current)
        } else {
          const stepBeats = e.shiftKey ? 1 : snapDiv
          panTimelinePx(dir * stepBeats * pxPerBeatRef.current)
        }
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [
    deleteSelected,
    transposeSelected,
    nudgeSelected,
    duplicateSelected,
    quantizeSelected,
    copySelected,
    pasteClipboard,
    snapDiv,
    soloClip,
    alignTimeline,
    isPlaying,
    clip,
    bpm,
    beatsPerBar,
    tienda,
    getPositionMs,
    zoomHorizontalAtPlayhead,
    panTimelinePx,
  ])

  if (!clip || clip.tipo !== 'midi') {
    return (
      <PianoRollEmptyShell
        title="Piano roll"
        message="Sincronizando el clip MIDI de la ventana principal…"
      />
    )
  }

  const velLaneH = showVelocity ? 56 : 0

  return (
    <div
      ref={rootRef}
      className={`flex flex-col bg-panel ${embedded ? 'h-[320px] border-t border-border' : 'h-full'}`}
      tabIndex={0}
      onPointerDownCapture={() => {
        rootRef.current?.focus({ preventScroll: true })
      }}
    >
      <PianoRollToolbar
        herramienta={herramienta}
        onHerramienta={setHerramienta}
        snapOn={snapOn}
        onSnapToggle={() => setSnapOn((v) => !v)}
        snapValor={projectSnapValor}
        snapDiv={snapDiv}
        onSnapDiv={setSnapDiv}
        onZoomIn={() => zoomHorizontalAtPlayhead(true)}
        onZoomOut={() => zoomHorizontalAtPlayhead(false)}
        onZoomVertical={() => setKeyH((h) => (h >= 20 ? KEY_H_BASE : h + 3))}
        showVelocity={showVelocity}
        onToggleVelocity={() => setShowVelocity((v) => !v)}
        showExpression={showExpression}
        onToggleExpression={() => setShowExpression((v) => !v)}
        onQuantize={quantizeSelected}
        quantizeMode={quantizeMode}
        onQuantizeMode={setQuantizeMode}
        quantizeStrength={quantizeStrength}
        onQuantizeStrength={setQuantizeStrength}
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onDedupe={dedupeNotes}
        onTranspose={transposeSelected}
        onNudge={nudgeSelected}
        onVelocitySet={setVelocitySelected}
        onVelocityScale={scaleVelocitySelected}
        showShortcuts={showShortcuts}
        onToggleShortcuts={() => setShowShortcuts((v) => !v)}
        grooves={GROOVE_LIBRARY.map((g) => ({ id: g.id, nombre: g.nombre }))}
        onGroove={(grooveId) => {
          void tienda.executor.execute('midi.applyGroove', {
            pistaId: trackId,
            clipId,
            grooveId,
            strength: 0.85,
            seed: 11,
            noteIds: selectedIds.size ? [...selectedIds] : undefined,
          })
        }}
        onSaveStyle={() => {
          const nombre = window.prompt('Nombre del estilo:', clip?.nombre || 'Estilo')
          if (!nombre?.trim()) return
          const tagsRaw = window.prompt('Tags (coma), opcional:', 'worship') ?? ''
          const tags = tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
          const global = window.confirm('¿Guardar también en biblioteca global?')
          void import('@/src/lib/styles/ops').then(({ styleSaveFromClip }) =>
            styleSaveFromClip(tienda, {
              pistaId: trackId,
              clipId,
              nombre: nombre.trim(),
              tags,
              global,
            }).then((r) => {
              if (!r.ok) window.alert(r.message)
            }),
          )
        }}
        onExportScorePdf={() => {
          void import('@/src/lib/midi-score-export').then(({ exportClipScorePdfDialog }) =>
            exportClipScorePdfDialog(tienda, trackId, clipId),
          )
        }}
        onOpenMidiMd={() => {
          void import('@/src/lib/open-midi-clip-md').then(({ openMidiClipMdPanel }) =>
            openMidiClipMdPanel(tienda, clipId, trackId),
          )
        }}
        notasCount={notes.length}
        seleccionCount={selectedIds.size}
        duplicadosCount={duplicadosCount}
        dirty={dirty}
        nombreClip={clip.nombre || 'Clip MIDI'}
      />

      <PianoRollTransport
        clipInicioBeats={clip.inicio ?? 0}
        clipDuracionBeats={clip.duracion ?? clipDurationBeats}
        soloClip={soloClip}
        onSoloClipChange={setSoloClip}
        alignTimeline={alignTimeline}
        onAlignTimelineChange={(v) => {
          if (!v) setLocalPlayheadMs(getPositionMs())
          setAlignTimeline(v)
        }}
        followPlayhead={followPlayhead}
        onFollowPlayheadChange={setFollowPlayhead}
      />

      {selectedIds.size > 0 && (
        <div className="relative flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">
            {selectedIds.size === 1 ? 'Nota' : `${selectedIds.size} notas`}
          </span>
          <button
            type="button"
            onClick={askAiAboutSelection}
            title="Preguntar a Jas sobre esta selección (Ctrl+L)"
            className="inline-flex items-center gap-1 rounded-md bg-accent-amber/20 px-2 py-0.5 text-[10px] font-semibold text-foreground ring-1 ring-accent-amber/50 hover:bg-accent-amber/30"
          >
            <MessageSquareQuote className="size-3" />
            Preguntar a Jas
            <kbd className="ml-0.5 rounded bg-background/80 px-1 font-mono text-[9px] text-muted-foreground">
              Ctrl+L
            </kbd>
          </button>
          {selectedIds.size === 1 &&
            (() => {
              const n = notes.find((x) => selectedIds.has(x.id))
              if (!n) return null
              return (
                <>
                  <label className="flex items-center gap-1">
                    Pitch
                    <input
                      type="number"
                      min={LOWEST}
                      max={HIGHEST}
                      value={n.pitch}
                      className="h-5 w-12 rounded border border-border bg-background px-1"
                      onChange={(e) => {
                        const pitch = Math.max(LOWEST, Math.min(HIGHEST, Number(e.target.value) || n.pitch))
                        const next = notes.map((x) => (x.id === n.id ? { ...x, pitch } : x))
                        setNotes(next)
                        setDirty(true)
                        tapAudition(pitch, n.velocidad, 200)
                        void persist(next)
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Inicio
                    <input
                      type="number"
                      step={0.01}
                      min={0}
                      value={Number(n.inicio.toFixed(3))}
                      className="h-5 w-16 rounded border border-border bg-background px-1"
                      onChange={(e) => {
                        const inicio = Math.max(0, Number(e.target.value) || 0)
                        const next = notes.map((x) => (x.id === n.id ? { ...x, inicio } : x))
                        setNotes(next)
                        setDirty(true)
                        void persist(next)
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Dur
                    <input
                      type="number"
                      step={0.01}
                      min={0.01}
                      value={Number(n.duracion.toFixed(3))}
                      className="h-5 w-16 rounded border border-border bg-background px-1"
                      onChange={(e) => {
                        const duracion = Math.max(0.01, Number(e.target.value) || snapDiv)
                        const next = notes.map((x) => (x.id === n.id ? { ...x, duracion } : x))
                        setNotes(next)
                        setDirty(true)
                        void persist(next)
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Vel
                    <input
                      type="number"
                      min={1}
                      max={127}
                      value={n.velocidad}
                      className="h-5 w-12 rounded border border-border bg-background px-1"
                      onChange={(e) => {
                        const velocidad = Math.max(1, Math.min(127, Number(e.target.value) || 1))
                        const next = notes.map((x) => (x.id === n.id ? { ...x, velocidad } : x))
                        setNotes(next)
                        setDirty(true)
                        tapAudition(n.pitch, velocidad, 180)
                        void persist(next)
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    Ch
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={n.canal ?? 0}
                      className="h-5 w-10 rounded border border-border bg-background px-1"
                      onChange={(e) => {
                        const canal = Math.max(0, Math.min(15, Number(e.target.value) || 0))
                        const next = notes.map((x) => (x.id === n.id ? { ...x, canal } : x))
                        setNotes(next)
                        setDirty(true)
                        void persist(next)
                      }}
                    />
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={Boolean(n.mute)}
                      onChange={(e) => {
                        const mute = e.target.checked
                        const next = notes.map((x) => (x.id === n.id ? { ...x, mute } : x))
                        setNotes(next)
                        setDirty(true)
                        void persist(next)
                      }}
                    />
                    Mute
                  </label>
                </>
              )
            })()}
          {selectedIds.size > 1 && (
            <span>Edición grupal: mover / duración / velocity en grid o Vel±</span>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-panel-raised"
          style={{ width: keysWidth }}
        >
          {/* Misma altura que PianoRollTimelineRuler para alinear teclas ↔ notas */}
          <div className="shrink-0 border-b border-border/60 bg-panel" style={{ height: RULER_H }} />
          <div
            ref={keysScrollRef}
            data-piano-keys
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
            onScroll={syncVerticalFromKeys}
          >
            <div
              className="touch-none select-none"
              style={{ height: gridHeight }}
              onPointerDown={onKeyboardPointerDown}
              onPointerMove={onKeyboardPointerMove}
              onPointerUp={onKeyboardPointerEnd}
              onPointerCancel={onKeyboardPointerEnd}
            >
              {Array.from({ length: KEYS }).map((_, i) => {
                const pitch = HIGHEST - i
                const black = isBlack(pitch)
                const active = heldKey === pitch
                const selectedHere = [...selectedIds].some(
                  (id) => notes.find((n) => n.id === id)?.pitch === pitch,
                )
                return (
                  <div
                    key={pitch}
                    className={`pointer-events-none flex w-full items-center justify-end border-b border-border/40 pr-1.5 font-mono text-[9px] ${
                      active
                        ? 'bg-accent-amber/40 text-foreground'
                        : selectedHere
                          ? 'bg-accent-amber/15'
                          : black
                            ? 'bg-background/80 text-muted-foreground'
                            : 'bg-panel-raised text-foreground'
                    }`}
                    style={{ height: keyH }}
                    title={`${noteName(pitch)} · MIDI ${pitch}`}
                  >
                    {pitch % 12 === 0 ? noteName(pitch) : ''}
                  </div>
                )
              })}
            </div>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Redimensionar teclado"
            title="Arrastrar para redimensionar el teclado"
            onPointerDown={beginKeysResize}
            className="absolute inset-y-0 right-0 z-20 w-1.5 cursor-col-resize hover:bg-accent-amber/50 active:bg-accent-amber"
          />
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-auto"
          onScroll={syncVerticalFromGrid}
        >
          <div className="relative" style={{ width: gridWidth }}>
            <PianoRollTimelineRuler
              pxPerBeat={pxPerBeat}
              durationBeats={viewDurationBeats}
              beatsPerBar={beatsPerBar}
              clipInicioBeats={clip?.inicio ?? 0}
              clipDurationBeats={clipDurationBeats}
              snapDivision={snapOn ? snapDiv : 0}
              onSeekBeats={seekAbsBeats}
            />
            <div
              ref={gridRef}
              className={`relative ${
                herramienta === 'borrar'
                  ? 'cursor-not-allowed'
                  : herramienta === 'dibujar'
                    ? 'cursor-cell'
                    : 'cursor-crosshair'
              }`}
              style={{ width: gridWidth, height: gridHeight + velLaneH }}
              onDoubleClick={(e) => {
                if (herramienta === 'borrar') return
                if ((e.target as HTMLElement).closest('[data-note]')) return
                addNoteAt(e.clientX, e.clientY, e.currentTarget)
              }}
              onContextMenu={(e) => {
                // Click derecho = marquee; no menú contextual del navegador.
                e.preventDefault()
              }}
              onPointerDown={(e) => {
              const isRight = e.button === 2
              const isLeft = e.button === 0
              if (!isLeft && !isRight) return

              const gridEl = e.currentTarget
              const toLocal = (clientX: number, clientY: number) => {
                const r = gridEl.getBoundingClientRect()
                return { x: clientX - r.left, y: clientY - r.top }
              }
              const { x, y } = toLocal(e.clientX, e.clientY)
              if (y > gridHeight) return

              const overNote = Boolean((e.target as HTMLElement).closest('[data-note]'))
              // Alt+Ctrl o Alt: crear nota con duración (paridad gestual arrange / piano)
              const wantCreateDur =
                isLeft && !overNote && (herramienta === 'dibujar' || e.altKey)

              // Marquee: izquierdo en vacío, o derecho en vacío (derecho sobre nota = borrar)
              const wantLasso =
                (isRight && !overNote) ||
                (isLeft &&
                  !overNote &&
                  !wantCreateDur &&
                  herramienta !== 'borrar')

              if (isLeft && !wantLasso) {
                if (overNote) return
                if (wantCreateDur) {
                  addNoteAt(e.clientX, e.clientY, e.currentTarget, true)
                  return
                }
                if (herramienta === 'borrar') return
                return
              }

              if (!wantLasso) return

              e.preventDefault()
              e.stopPropagation()
              const additive = e.shiftKey || e.ctrlKey || e.metaKey
              const notesAtStart = notesRef.current
              setLasso({ x0: x, y0: y, x1: x, y1: y })

              const move = (ev: PointerEvent) => {
                const p = toLocal(ev.clientX, ev.clientY)
                setLasso((L) => (L ? { ...L, x1: p.x, y1: Math.min(p.y, gridHeight) } : L))
              }
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                window.removeEventListener('pointercancel', up)
                const p = toLocal(ev.clientX, ev.clientY)
                const xx = p.x
                const yy = Math.min(p.y, gridHeight)
                const x0 = Math.min(x, xx)
                const x1 = Math.max(x, xx)
                const y0 = Math.min(y, yy)
                const y1 = Math.max(y, yy)
                setLasso(null)
                if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
                  if (!additive) {
                    setSelectedIds(new Set())
                    // Clic vacío (seleccionar): seek como en arrange
                    if (herramienta === 'seleccionar' && isLeft) {
                      const relBeat = Math.max(0, Math.min(viewDurationBeats, x / pxPerBeat))
                      seekAbsBeats(clipStartBeat + relBeat)
                    }
                  }
                  return
                }
                const hit = notesAtStart.filter((n) => {
                  const left = n.inicio * pxPerBeat
                  const right = left + Math.max(6, n.duracion * pxPerBeat)
                  const top = (HIGHEST - n.pitch) * keyH
                  const bottom = top + keyH
                  return right >= x0 && left <= x1 && bottom >= y0 && top <= y1
                })
                setSelectedIds((prev) => {
                  if (additive) {
                    const next = new Set(prev)
                    hit.forEach((n) => next.add(n.id))
                    return next
                  }
                  return new Set(hit.map((n) => n.id))
                })
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
              window.addEventListener('pointercancel', up)
            }}
          >
            {Array.from({ length: KEYS }).map((_, i) => {
              const pitch = HIGHEST - i
              return (
                <div
                  key={pitch}
                  className={`absolute left-0 right-0 border-b ${
                    isBlack(pitch) ? 'border-border/30 bg-background/40' : 'border-border/20'
                  }`}
                  style={{ top: i * keyH, height: keyH, width: gridWidth }}
                />
              )
            })}

            {gridLines.map((line) => {
              const rank = zoomLevelRank(line.spacingBeats, zoomPrimary)
              const count = Math.ceil(viewDurationBeats / line.spacingBeats) + 1
              const className =
                rank === 0
                  ? 'border-sky-300/80'
                  : rank === 1
                    ? 'border-sky-400/55'
                    : rank === 2
                      ? 'border-sky-500/35'
                      : 'border-border/25'
              return Array.from({ length: count }).map((_, i) => {
                if (rank > 0) {
                  const coarser = rank === 1 ? zoomPrimary : zoomPrimary / 2
                  const beatsFromCoarser = (i * line.spacingBeats) % coarser
                  if (Math.abs(beatsFromCoarser) < 1e-9) return null
                }
                return (
                  <div
                    key={`${line.kind}-${line.spacingBeats}-${i}`}
                    className={`pointer-events-none absolute top-0 border-l ${className}`}
                    style={{
                      left: i * line.spacingBeats * pxPerBeat,
                      height: gridHeight,
                      borderLeftWidth: rank === 0 ? 2 : rank === 1 ? 1.5 : 1,
                    }}
                  />
                )
              })
            })}

            {/* Zona más allá del clip: misma rejilla, distinta apariencia */}
            <div
              className="pointer-events-none absolute top-0 z-[5] border-l-2 border-dashed border-sky-300/70 bg-background/55"
              style={{
                left: clipDurationBeats * pxPerBeat,
                width: Math.max(0, (viewDurationBeats - clipDurationBeats) * pxPerBeat),
                height: gridHeight + velLaneH,
              }}
              title="Fuera del clip MIDI"
            />

            {lasso && (
              <div
                className="pointer-events-none absolute z-30 border border-accent-amber/80 bg-accent-amber/10"
                style={{
                  left: Math.min(lasso.x0, lasso.x1),
                  top: Math.min(lasso.y0, lasso.y1),
                  width: Math.abs(lasso.x1 - lasso.x0),
                  height: Math.abs(lasso.y1 - lasso.y0),
                }}
              />
            )}

      {selectedIds.size > 0 && (() => {
        const selected = notes.filter((n) => selectedIds.has(n.id))
        if (!selected.length) return null
        const left = Math.min(...selected.map((n) => n.inicio)) * pxPerBeat
        const top = Math.min(...selected.map((n) => (HIGHEST - n.pitch) * keyH))
        const right = Math.max(...selected.map((n) => (n.inicio + n.duracion) * pxPerBeat))
        const btnLeft = Math.max(8, Math.min(left + (right - left) / 2 - 70, gridWidth - 160))
        const btnTop = Math.max(8, top - 36)
        return (
          <button
            type="button"
            onClick={askAiAboutSelection}
            title="Preguntar a Jas sobre esta selección (Ctrl+L)"
            className="pointer-events-auto absolute z-40 inline-flex items-center gap-1 rounded-md bg-accent-amber px-2 py-1 text-[10px] font-semibold text-background shadow-lg ring-1 ring-black/20 hover:brightness-110"
            style={{ left: btnLeft, top: btnTop }}
          >
            <MessageSquareQuote className="size-3" />
            Preguntar a Jas
            <kbd className="ml-0.5 rounded bg-background/20 px-1 font-mono text-[9px]">Ctrl+L</kbd>
          </button>
        )
      })()}

            {midiProposal &&
              midiProposal.trackId === trackId &&
              (!midiProposal.clipId || midiProposal.clipId === clipId) &&
              midiProposal.notes.map((n, i) => {
                const top = (HIGHEST - n.pitch) * keyH
                const left = n.inicio * pxPerBeat
                const width = Math.max(4, n.duracion * pxPerBeat)
                const add = n.kind !== 'remove'
                return (
                  <div
                    key={`prop-${i}-${n.pitch}-${n.inicio}`}
                    className={`pointer-events-none absolute z-[25] rounded-sm ring-1 ${
                      add
                        ? 'bg-emerald-500/45 ring-emerald-400/80'
                        : 'bg-red-500/40 ring-red-400/80 line-through opacity-80'
                    }`}
                    style={{ top, left, width, height: Math.max(4, keyH - 1) }}
                    title={add ? 'Propuesta IA (+)' : 'Propuesta IA (−)'}
                  />
                )
              })}

            {useCanvas && (
              <PianoRollCanvasNotes
                notes={notes}
                selectedIds={selectedIds}
                width={gridWidth}
                height={gridHeight}
                pxPerBeat={pxPerBeat}
                keyH={keyH}
                highest={HIGHEST}
                lowest={LOWEST}
                onHit={(hit, ev) => {
                  if (!hit) return
                  const n = notesRef.current.find((x) => x.id === hit.id)
                  if (!n) return
                  // Clic derecho = borrar nota (o toda la selección si está incluida)
                  if (ev.button === 2) {
                    const ids =
                      selectedIds.has(hit.id) && selectedIds.size > 1
                        ? selectedIds
                        : new Set([hit.id])
                    const next = notesRef.current.filter((x) => !ids.has(x.id))
                    setNotes(next)
                    setSelectedIds((prev) => {
                      const s = new Set(prev)
                      for (const id of ids) s.delete(id)
                      return s
                    })
                    setDirty(true)
                    void persist(next)
                    return
                  }
                  if (herramienta === 'borrar') {
                    const next = notesRef.current.filter((x) => x.id !== hit.id)
                    setNotes(next)
                    setDirty(true)
                    void persist(next)
                    return
                  }
                  // Shift = toggle selección. Ctrl/Cmd + cuerpo = duplicar al arrastrar (clic sin mover = toggle).
                  if (ev.shiftKey) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(hit.id)) next.delete(hit.id)
                      else next.add(hit.id)
                      return next
                    })
                    tapAudition(n.pitch, n.velocidad, 180)
                    return
                  }
                  beginNoteDrag(ev, hit.id, hit.edge, n.pitch, n.velocidad)
                }}
              />
            )}

            {!useCanvas &&
            notes.map((n) => {
              const top = (HIGHEST - n.pitch) * keyH
              const left = n.inicio * pxPerBeat
              const width = Math.max(6, n.duracion * pxPerBeat)
              const selected = selectedIds.has(n.id)
              const velAlpha = 0.35 + (n.velocidad / 127) * 0.55
              return (
                <div
                  key={n.id}
                  data-note
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => {
                    if (e.button !== 0 && e.button !== 2) return
                    e.stopPropagation()
                    e.preventDefault()
                    // Clic derecho = borrar nota (o toda la selección si está incluida)
                    if (e.button === 2) {
                      const ids =
                        selectedIds.has(n.id) && selectedIds.size > 1
                          ? selectedIds
                          : new Set([n.id])
                      const next = notesRef.current.filter((x) => !ids.has(x.id))
                      setNotes(next)
                      setSelectedIds((prev) => {
                        const s = new Set(prev)
                        for (const id of ids) s.delete(id)
                        return s
                      })
                      setDirty(true)
                      void persist(next)
                      return
                    }
                    if (herramienta === 'borrar') {
                      const next = notesRef.current.filter((x) => x.id !== n.id)
                      setNotes(next)
                      setSelectedIds((prev) => {
                        const s = new Set(prev)
                        s.delete(n.id)
                        return s
                      })
                      setDirty(true)
                      void persist(next)
                      return
                    }
                    // Shift = toggle. Ctrl/Cmd + cuerpo = duplicar al arrastrar (clic sin mover = toggle).
                    if (e.shiftKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(n.id)) next.delete(n.id)
                        else next.add(n.id)
                        return next
                      })
                      tapAudition(n.pitch, n.velocidad, 180)
                      return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    const localX = e.clientX - rect.left
                    const edge: false | 'start' | 'end' =
                      localX > width - 6 ? 'end' : localX < 6 ? 'start' : false
                    beginNoteDrag(e.nativeEvent, n.id, edge, n.pitch, n.velocidad)
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  className={`absolute z-10 touch-none rounded-sm border ${
                    selected
                      ? 'border-accent-amber ring-1 ring-accent-amber'
                      : 'border-violet-300/40 hover:brightness-110'
                  }`}
                  style={{
                    top: top + 1,
                    left,
                    width,
                    height: keyH - 2,
                    backgroundColor: `rgba(139, 92, 246, ${velAlpha})`,
                  }}
                  title={`${noteName(n.pitch)} · v${n.velocidad}`}
                >
                  <span className="pointer-events-none absolute right-0 top-0 h-full w-1.5 rounded-r-sm bg-white/20" />
                </div>
              )
            })}

            {showVelocity && (
              <div
                className="absolute left-0 border-t border-border bg-panel-raised/80"
                style={{ top: gridHeight, width: gridWidth, height: velLaneH }}
              >
                {notes.map((n) => {
                  const left = n.inicio * pxPerBeat
                  const width = Math.max(4, n.duracion * pxPerBeat)
                  const h = (n.velocidad / 127) * (velLaneH - 8)
                  const selected = selectedIds.has(n.id)
                  return (
                    <div
                      key={`v-${n.id}`}
                      data-note
                      className={`absolute bottom-1 cursor-ns-resize rounded-sm ${
                        selected ? 'bg-accent-amber' : 'bg-violet-500/70'
                      }`}
                      style={{ left, width: Math.min(width, 14), height: Math.max(3, h) }}
                      title={`Velocity ${n.velocidad}`}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        const startY = e.clientY
                        const ids = selectedIds.has(n.id) ? selectedIds : new Set([n.id])
                        setSelectedIds(ids)
                        const originsVel = new Map(
                          notes.filter((x) => ids.has(x.id)).map((x) => [x.id, x.velocidad]),
                        )
                        const move2 = (ev: PointerEvent) => {
                          const dv = Math.round((startY - ev.clientY) * 1.5)
                          setNotes((prev) =>
                            prev.map((x) => {
                              const o = originsVel.get(x.id)
                              if (o === undefined) return x
                              return { ...x, velocidad: Math.max(1, Math.min(127, o + dv)) }
                            }),
                          )
                          setDirty(true)
                        }
                        const up = () => {
                          window.removeEventListener('pointermove', move2)
                          window.removeEventListener('pointerup', up)
                          setNotes((prev) => {
                            const cur = prev.find((x) => x.id === n.id)
                            if (cur) {
                              tapAudition(cur.pitch, cur.velocidad, 180)
                            }
                            void persist(prev)
                            return prev
                          })
                        }
                        window.addEventListener('pointermove', move2)
                        window.addEventListener('pointerup', up)
                      }}
                    />
                  )
                })}
              </div>
            )}
          </div>

          {showExpression && (
            <PianoRollExpressionLanes
              width={gridWidth}
              durationBeats={viewDurationBeats}
              pxPerBeat={pxPerBeat}
              expression={clip?.expression}
              onSetCc={(cc, puntos) => {
                void tienda.executor.execute('midi.setCC', {
                  pistaId: trackId,
                  clipId,
                  cc,
                  puntos,
                })
              }}
              onSetPitchBend={(puntos) => {
                void tienda.executor.execute('midi.setPitchBend', {
                  pistaId: trackId,
                  clipId,
                  puntos,
                })
              }}
            />
          )}

          {/* Playhead sincronizado con arrange (RAF estable, cruza regla + grid) */}
          <div
            className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
            style={{ height: RULER_H + gridHeight + velLaneH }}
          >
            <PlayheadOverlay
              mode="content"
              getSeconds={getPlayheadSeconds}
              bpm={bpm}
              beatToPixel={beatToPianoPixel}
              onPointerDown={onPlayheadPointerDown}
            />
          </div>
          </div>
        </div>
      </div>

            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-muted-foreground">
        <span>
          Rueda = zoom · Shift+rueda = pan · Regla = seek · Alt(+Ctrl)+arrastre vacío = nota · Alt en nota = sin imán
        </span>
        <span>S imán notas · Magnet seek · Ctrl+arrastrar = duplicar · ↑↓ pitch · ←→ pan/nudge · G vel · F CC · ? atajos</span>
      </div>
    </div>
  )
}

function PianoRollEmptyShell({
  title,
  message,
  clips,
  onPick,
}: {
  title: string
  message: string
  clips?: Array<{ trackId: string; clipId: string; label: string }>
  onPick?: (trackId: string, clipId: string) => void
}) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <PianoRollToolbar
        herramienta="seleccionar"
        onHerramienta={() => {}}
        snapOn
        onSnapToggle={() => {}}
        snapValor={0.25}
        snapDiv={0.25}
        onSnapDiv={() => {}}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onZoomVertical={() => {}}
        showVelocity
        onToggleVelocity={() => {}}
        showExpression
        onToggleExpression={() => {}}
        onQuantize={() => {}}
        onDuplicate={() => {}}
        onDelete={() => {}}
        onTranspose={() => {}}
        onNudge={() => {}}
        showShortcuts={false}
        onToggleShortcuts={() => {}}
        grooves={GROOVE_LIBRARY.map((g) => ({ id: g.id, nombre: g.nombre }))}
        onGroove={() => {}}
        notasCount={0}
        seleccionCount={0}
        dirty={false}
        nombreClip={title}
      />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <Piano className="size-8 text-muted-foreground/40" />
        <p className="max-w-[280px] text-[11px] text-muted-foreground">{message}</p>
        {clips && clips.length > 0 && onPick && (
          <select
            className="max-w-[280px] rounded-md border border-border bg-panel-raised px-2 py-1.5 text-[11px] text-foreground"
            defaultValue=""
            onChange={(e) => {
              const [trackId, clipId] = e.target.value.split('\t')
              if (trackId && clipId) onPick(trackId, clipId)
            }}
          >
            <option value="" disabled>
              Elegir clip MIDI…
            </option>
            {clips.map((c) => (
              <option key={`${c.trackId}:${c.clipId}`} value={`${c.trackId}\t${c.clipId}`}>
                {c.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

export function PianoRollToolPanel() {
  const urlFocus = getUndockUrlFocus()
  const [override, setOverride] = useState<{ trackId: string; clipId: string } | null>(null)
  const hintTrack = override?.trackId || urlFocus.trackId
  const hintClip = override?.clipId || urlFocus.clipId

  // Primitivos estables — no devolver objetos/arrays nuevos desde el selector.
  const resolvedKey = useDAWState((s: DAWState) => {
    const hit = resolvePianoRollClip(s, { trackId: hintTrack, clipId: hintClip })
    return hit ? `${hit.trackId}\t${hit.clipId}` : ''
  })
  const midiClipOptions = useDAWState((s: DAWState) => {
    const list = listMidiClips(s)
    return list.map((c) => `${c.trackId}\t${c.clipId}\t${c.label}`).join('\n')
  })

  const trackId = override?.trackId || (resolvedKey ? resolvedKey.split('\t')[0] : null) || urlFocus.trackId
  const clipId = override?.clipId || (resolvedKey ? resolvedKey.split('\t')[1] : null) || urlFocus.clipId
  const midiClips = useMemo(() => {
    if (!midiClipOptions) return []
    return midiClipOptions.split('\n').map((line) => {
      const [t, c, ...rest] = line.split('\t')
      return { trackId: t, clipId: c, label: rest.join('\t') || c }
    })
  }, [midiClipOptions])

  if (!trackId || !clipId) {
    return (
      <PianoRollEmptyShell
        title="Piano roll"
        message="Selecciona o crea un clip MIDI (doble clic en el arrange) para editar las notas aquí."
        clips={midiClips}
        onPick={(t, c) => setOverride({ trackId: t, clipId: c })}
      />
    )
  }

  return <PianoRoll trackId={trackId} clipId={clipId} />
}

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Plus, Piano } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { usePlaybackActions } from '@/components/playback-provider'
import type { DAWState } from '../../shared/src/types/state'
import type { MidiNote } from '../../shared/src/types/clips'
import { adaptiveGridForZoom } from '../../shared/src/midi/grid'
import { quantizeBeats } from '../../shared/src/midi/ppq'
import { audioEngine } from '@/lib/audio-engine'
import { PianoRollCanvasNotes, shouldUseCanvasNotes } from '@/components/piano-roll-canvas-notes'
import { PianoRollExpressionLanes } from '@/components/piano-roll-expression-lanes'
import { PianoRollToolbar, type PianoRollTool } from '@/components/piano-roll-toolbar'
import { PianoRollTransport, PianoRollTimelineRuler } from '@/components/piano-roll-transport'
import type { MidiClipExpression } from '../../shared/src/types/clips'
import { GROOVE_LIBRARY } from '../../shared/src/midi/groove'
import { getUndockUrlFocus } from '@/lib/undock-window'
import { listMidiClips, resolvePianoRollClip } from '@/src/lib/selection-helpers'
import {
  routeMidiToTrack,
  routeMidiToActiveVst,
  setPreferredVstPreviewTrack,
} from '@/src/lib/plugin/vst-voice-router'
import { setEditorPreviewTrackId } from '@/src/lib/plugin/editor-preview-focus'

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
  const { getPositionMs } = usePlaybackActions()

  const [notes, setNotes] = useState<LocalNote[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [heldKey, setHeldKey] = useState<number | null>(null)
  const [pxPerBeat, setPxPerBeat] = useState(48)
  const [keyH, setKeyH] = useState(KEY_H_BASE)
  const [snapOn, setSnapOn] = useState(true)
  const [snapDiv, setSnapDiv] = useState(0.25)
  const [showVelocity, setShowVelocity] = useState(true)
  const [showExpression, setShowExpression] = useState(true)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [herramienta, setHerramienta] = useState<PianoRollTool>('seleccionar')
  const [clipboard, setClipboard] = useState<LocalNote[]>([])
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef(notes)
  const selectedRef = useRef(selectedIds)
  notesRef.current = notes
  selectedRef.current = selectedIds

  const clipStartBeat = clip?.inicio ?? 0
  const trackPlugins = useDAWState((s: DAWState) => {
    const tr = s.project.tracks.find((t) => t.id === trackId)
    return tr?.plugins
  })
  const draggingRef = useRef(false)
  const keysOffsetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clip || clip.tipo !== 'midi') return
    // No pisar edición local (drag / inspector) con el store.
    if (dirty || draggingRef.current) return
    setNotes(
      (clip.notas ?? []).map((n) => ({
        id: n.id,
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
        canal: n.canal,
        mute: n.mute,
      })),
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

  const previewNote = (pitch: number, velocity = 100) => {
    // ignoreMute: en el editor hay que oír la pista aunque otra esté en solo.
    if (
      routeMidiToTrack(trackId, true, pitch, velocity, {
        ignoreMute: true,
        plugins: trackPlugins,
      })
    ) {
      return
    }
    routeMidiToActiveVst(true, pitch, velocity, { ignoreMute: true })
  }
  const releaseNote = (pitch: number) => {
    if (routeMidiToTrack(trackId, false, pitch, 0, { ignoreMute: true, plugins: trackPlugins })) {
      return
    }
    routeMidiToActiveVst(false, pitch, 0, { ignoreMute: true })
  }
  const previewNoteRef = useRef(previewNote)
  const releaseNoteRef = useRef(releaseNote)
  previewNoteRef.current = previewNote
  releaseNoteRef.current = releaseNote
  const heldKeyRef = useRef<number | null>(null)

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
    if (!(e.buttons & 1)) return
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

  const durationBeats = useMemo(() => {
    const fromNotes = notes.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4)
    return Math.max(clip?.duracion ?? 4, fromNotes, 16)
  }, [notes, clip?.duracion])

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = playheadRef.current
      const scroll = scrollRef.current
      if (el) {
        const sourceMs = alignTimeline ? getPositionMs() : localPlayheadMs
        const absBeats = (sourceMs / 1000) * (bpm / 60)
        const rel = absBeats - clipStartBeat
        const inView = rel >= -0.05 && rel <= durationBeats + 0.05
        el.style.visibility = inView ? 'visible' : 'hidden'
        const x = rel * pxPerBeat
        el.style.transform = `translate3d(${x}px,0,0)`
        if (followPlayhead && alignTimeline && isPlaying && scroll && inView) {
          const viewL = scroll.scrollLeft
          const viewR = viewL + scroll.clientWidth
          const margin = scroll.clientWidth * 0.15
          if (x < viewL + margin || x > viewR - margin) {
            scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3)
          }
        }
      }
      const keys = keysOffsetRef.current
      if (keys && scroll) {
        keys.style.transform = `translateY(${-scroll.scrollTop}px)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [
    getPositionMs,
    localPlayheadMs,
    alignTimeline,
    bpm,
    clipStartBeat,
    durationBeats,
    pxPerBeat,
    followPlayhead,
    isPlaying,
  ])

  const gridWidth = durationBeats * pxPerBeat
  const gridHeight = KEYS * keyH
  const gridLines = useMemo(() => {
    const all = adaptiveGridForZoom(pxPerBeat, beatsPerBar)
    const bar = all.filter((l) => l.kind === 'bar')
    const beat = all.filter((l) => l.kind === 'beat')
    const sub = all.filter((l) => l.kind === 'subdivision').slice(-1)
    return [...bar, ...beat, ...sub].filter((l) => durationBeats / l.spacingBeats <= 512)
  }, [pxPerBeat, durationBeats, beatsPerBar])

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
   *  Alt = sin imán (posición libre). Al cambiar pitch se re-audiciona. */
  const beginNoteDrag = useCallback(
    (
      ev: Pick<PointerEvent, 'clientX' | 'clientY' | 'pointerId' | 'target' | 'altKey' | 'shiftKey'>,
      hitId: string,
      edge: false | 'start' | 'end',
      previewPitch: number,
      previewVel: number,
    ) => {
      if (herramienta === 'borrar') return
      const ids =
        selectedIds.has(hitId) && selectedIds.size > 0 ? selectedIds : new Set([hitId])
      setSelectedIds(ids)
      draggingRef.current = true
      setDirty(true)
      let lastAuditionPitch = previewPitch
      previewNoteRef.current(previewPitch, Math.max(previewVel, 100))

      const startX = ev.clientX
      const startY = ev.clientY
      const freeMove = Boolean(ev.altKey)
      const fineMove = Boolean(ev.shiftKey)
      const origins = new Map(
        notesRef.current.filter((x) => ids.has(x.id)).map((x) => [x.id, { ...x }]),
      )

      const quantOrFree = (beats: number) => {
        if (freeMove) return Math.max(0, beats)
        if (fineMove) return Math.max(0, quantizeBeats(beats, snapDiv / 4, 1))
        return snapBeat(beats)
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
          const primary = origins.get(hitId)
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
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        releaseNoteRef.current(lastAuditionPitch)
        try {
          target?.releasePointerCapture?.(pointerId)
        } catch {
          /* ignore */
        }
        setNotes((prev) => {
          void persist(prev)
          return prev
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [herramienta, selectedIds, snapDiv, snapBeat, pxPerBeat, keyH, persist],
  )

  const addNoteAt = (clientX: number, clientY: number, gridEl: HTMLDivElement, dragDur = false) => {
    const rect = gridEl.getBoundingClientRect()
    const x = clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    const y = clientY - rect.top + (scrollRef.current?.scrollTop ?? 0)
    const inicio = snapBeat(x / pxPerBeat)
    const pitch = Math.max(LOWEST, Math.min(HIGHEST, HIGHEST - Math.floor(y / keyH)))
    const note: LocalNote = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      pitch,
      inicio,
      duracion: snapDiv,
      velocidad: 90,
    }
    previewNote(pitch, 90)
    window.setTimeout(() => releaseNote(pitch), 220)
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
    const copies = clipboard.map((n) => ({
      ...n,
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      inicio: snapBeat(n.inicio - origin + origin + snapDiv),
    }))
    const next = [...notesRef.current, ...copies]
    setNotes(next)
    setSelectedIds(new Set(copies.map((c) => c.id)))
    setDirty(true)
    void persist(next)
  }, [clipboard, persist, snapBeat, snapDiv])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
        return

      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey

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
        setPxPerBeat((z) => Math.min(256, z * 1.25))
        return
      }
      if (!mod && (key === '-' || key === '_')) {
        e.preventDefault()
        setPxPerBeat((z) => Math.max(12, z / 1.25))
        return
      }
      if (!mod && ['1', '2', '3', '4', '5'].includes(key)) {
        e.preventDefault()
        const map: Record<string, number> = { '1': 1, '2': 0.5, '3': 0.25, '4': 0.125, '5': 0.0625 }
        setSnapDiv(map[key]!)
        setSnapOn(true)
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
      if (mod && key === 'c') {
        e.preventDefault()
        copySelected()
        return
      }
      if (mod && key === 'v') {
        e.preventDefault()
        pasteClipboard()
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
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        nudgeSelected(-(e.shiftKey ? 1 : snapDiv))
        return
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        nudgeSelected(e.shiftKey ? 1 : snapDiv)
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
    tienda,
    getPositionMs,
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
      className={`flex flex-col bg-panel ${embedded ? 'h-[320px] border-t border-border' : 'h-full'}`}
      tabIndex={0}
    >
      <PianoRollToolbar
        herramienta={herramienta}
        onHerramienta={setHerramienta}
        snapOn={snapOn}
        onSnapToggle={() => setSnapOn((v) => !v)}
        snapDiv={snapDiv}
        onSnapDiv={setSnapDiv}
        onZoomIn={() => setPxPerBeat((z) => Math.min(256, z * 1.25))}
        onZoomOut={() => setPxPerBeat((z) => Math.max(12, z / 1.25))}
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
        notasCount={notes.length}
        seleccionCount={selectedIds.size}
        dirty={dirty}
        nombreClip={clip.nombre || 'Clip MIDI'}
      />

      <PianoRollTransport
        clipInicioBeats={clip.inicio ?? 0}
        clipDuracionBeats={clip.duracion ?? durationBeats}
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">
            {selectedIds.size === 1 ? 'Nota' : `${selectedIds.size} notas`}
          </span>
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
                        previewNote(pitch, n.velocidad)
                        window.setTimeout(() => releaseNote(pitch), 200)
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
                        previewNote(n.pitch, velocidad)
                        window.setTimeout(() => releaseNote(n.pitch), 180)
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
        <div className="flex w-14 shrink-0 flex-col overflow-hidden border-r border-border bg-panel-raised">
          {/* Misma altura que PianoRollTimelineRuler para alinear teclas ↔ notas */}
          <div className="shrink-0 border-b border-border/60 bg-panel" style={{ height: RULER_H }} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <div
              ref={keysOffsetRef}
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
                    className={`pointer-events-none flex w-full items-center justify-end border-b border-border/40 pr-1 font-mono text-[9px] ${
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
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto">
          <PianoRollTimelineRuler
            pxPerBeat={pxPerBeat}
            durationBeats={durationBeats}
            beatsPerBar={beatsPerBar}
            clipInicioBeats={clip?.inicio ?? 0}
            onSeekBeats={(absBeats) => {
              const sec = (absBeats * 60) / Math.max(1, bpm)
              if (alignTimeline) {
                void tienda.executor.execute('transport.seek', { segundos: sec })
              } else {
                setLocalPlayheadMs(sec * 1000)
                const scroll = scrollRef.current
                if (scroll) {
                  const x = (absBeats - clipStartBeat) * pxPerBeat
                  scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.3)
                }
              }
            }}
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
            onPointerDown={(e) => {
              if (e.button !== 0) return
              if ((e.target as HTMLElement).closest('[data-note]')) return
              const rect = e.currentTarget.getBoundingClientRect()
              const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
              const y = e.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0)
              if (y > gridHeight) return

              if (herramienta === 'dibujar' || e.altKey) {
                addNoteAt(e.clientX, e.clientY, e.currentTarget, true)
                return
              }
              if (herramienta === 'borrar') return

              setLasso({ x0: x, y0: y, x1: x, y1: y })
              const move = (ev: PointerEvent) => {
                const xx = ev.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
                const yy = ev.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0)
                setLasso((L) => (L ? { ...L, x1: xx, y1: Math.min(yy, gridHeight) } : L))
              }
              const up = (ev: PointerEvent) => {
                window.removeEventListener('pointermove', move)
                window.removeEventListener('pointerup', up)
                const xx = ev.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
                const yy = Math.min(
                  ev.clientY - rect.top + (scrollRef.current?.scrollTop ?? 0),
                  gridHeight,
                )
                const x0 = Math.min(x, xx)
                const x1 = Math.max(x, xx)
                const y0 = Math.min(y, yy)
                const y1 = Math.max(y, yy)
                setLasso(null)
                if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) {
                  if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelectedIds(new Set())
                  return
                }
                const hit = notes.filter((n) => {
                  const left = n.inicio * pxPerBeat
                  const right = left + Math.max(6, n.duracion * pxPerBeat)
                  const top = (HIGHEST - n.pitch) * keyH
                  const bottom = top + keyH
                  return right >= x0 && left <= x1 && bottom >= y0 && top <= y1
                })
                setSelectedIds((prev) => {
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    const next = new Set(prev)
                    hit.forEach((n) => next.add(n.id))
                    return next
                  }
                  return new Set(hit.map((n) => n.id))
                })
              }
              window.addEventListener('pointermove', move)
              window.addEventListener('pointerup', up)
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
              const count = Math.ceil(durationBeats / line.spacingBeats) + 1
              const className =
                line.kind === 'bar'
                  ? 'border-accent-amber/35'
                  : line.kind === 'beat'
                    ? 'border-border/45'
                    : line.kind === 'subdivision'
                      ? 'border-border/28'
                      : 'border-border/14'
              return Array.from({ length: count }).map((_, i) => {
                if (line.kind !== 'bar') {
                  const beatsFromBar = (i * line.spacingBeats) % beatsPerBar
                  if (Math.abs(beatsFromBar) < 1e-9) return null
                }
                return (
                  <div
                    key={`${line.kind}-${line.spacingBeats}-${i}`}
                    className={`pointer-events-none absolute top-0 border-l ${className}`}
                    style={{ left: i * line.spacingBeats * pxPerBeat, height: gridHeight }}
                  />
                )
              })
            })}

            <div
              ref={playheadRef}
              className={`pointer-events-none absolute top-0 left-0 z-20 w-px ${isPlaying ? 'bg-accent-amber' : 'bg-foreground/50'}`}
              style={{ height: gridHeight + velLaneH, visibility: 'hidden' }}
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
                  if (herramienta === 'borrar') {
                    const next = notesRef.current.filter((x) => x.id !== hit.id)
                    setNotes(next)
                    setDirty(true)
                    void persist(next)
                    return
                  }
                  if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
                    setSelectedIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(hit.id)) next.delete(hit.id)
                      else next.add(hit.id)
                      return next
                    })
                    previewNote(n.pitch, n.velocidad)
                    window.setTimeout(() => releaseNote(n.pitch), 180)
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
                    if (e.button !== 0) return
                    e.stopPropagation()
                    e.preventDefault()
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
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      setSelectedIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(n.id)) next.delete(n.id)
                        else next.add(n.id)
                        return next
                      })
                      previewNote(n.pitch, n.velocidad)
                      window.setTimeout(() => releaseNote(n.pitch), 180)
                      return
                    }
                    const rect = e.currentTarget.getBoundingClientRect()
                    const localX = e.clientX - rect.left
                    const edge: false | 'start' | 'end' =
                      localX > width - 6 ? 'end' : localX < 6 ? 'start' : false
                    beginNoteDrag(e.nativeEvent, n.id, edge, n.pitch, n.velocidad)
                  }}
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
                              previewNote(cur.pitch, cur.velocidad)
                              window.setTimeout(() => releaseNote(cur.pitch), 180)
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
              durationBeats={durationBeats}
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
        </div>
      </div>

            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-muted-foreground">
        <span>
          Clic nota = oír · Arrastrar = pitch/tiempo · Bordes = duración · Carril Vel = velocidad · Alt = sin imán · Shift = fino
        </span>
        <span>S imán · ↑↓ semitono · ←→ mover · G velocidad · F expresión · ? atajos</span>
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

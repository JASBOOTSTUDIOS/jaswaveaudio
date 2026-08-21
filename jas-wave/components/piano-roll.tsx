import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Piano } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { usePlayback } from '@/components/playback-provider'
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
}

const KEY_H_BASE = 14
const LOWEST = 24
const HIGHEST = 96
const KEYS = HIGHEST - LOWEST + 1
const SNAP_DIVISIONS = [1, 0.5, 0.25, 0.125, 0.0625] as const

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
  const { positionMs: livePositionMs } = usePlayback()
  const transportSec = livePositionMs / 1000

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
  const [lasso, setLasso] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const useCanvas = shouldUseCanvasNotes(notes.length)
  const scrollRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const notesRef = useRef(notes)
  const selectedRef = useRef(selectedIds)
  notesRef.current = notes
  selectedRef.current = selectedIds

  useEffect(() => {
    if (!clip || clip.tipo !== 'midi') return
    setNotes(
      (clip.notas ?? []).map((n) => ({
        id: n.id,
        pitch: n.pitch,
        inicio: n.inicio,
        duracion: n.duracion,
        velocidad: n.velocidad,
      })),
    )
    setDirty(false)
  }, [clip, clipId, trackId])

  useEffect(() => () => audioEngine.allNotesOff(), [])

  const durationBeats = useMemo(() => {
    const fromNotes = notes.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4)
    return Math.max(clip?.duracion ?? 4, fromNotes, 16)
  }, [notes, clip?.duracion])

  const gridWidth = durationBeats * pxPerBeat
  const gridHeight = KEYS * keyH
  const gridLines = useMemo(() => {
    const all = adaptiveGridForZoom(pxPerBeat)
    const bar = all.filter((l) => l.kind === 'bar')
    const beat = all.filter((l) => l.kind === 'beat')
    // Solo la subdivision más fina — evita miles de nodos DOM que congelan la UI
    const sub = all.filter((l) => l.kind === 'subdivision').slice(-1)
    return [...bar, ...beat, ...sub].filter(
      (l) => durationBeats / l.spacingBeats <= 512,
    )
  }, [pxPerBeat, durationBeats])

  const snapBeat = useCallback(
    (beats: number) => (snapOn ? Math.max(0, quantizeBeats(beats, snapDiv, 1)) : Math.max(0, beats)),
    [snapOn, snapDiv],
  )

  const persist = useCallback(
    async (next: LocalNote[]) => {
      await tienda.executor.execute('midi.notes.set', {
        pistaId: trackId,
        clipId,
        notas: next.map((n) => ({
          id: n.id,
          pitch: n.pitch,
          inicio: n.inicio,
          duracion: n.duracion,
          velocidad: n.velocidad,
        })),
        duracion: Math.max(
          clip?.duracion ?? 4,
          next.reduce((m, n) => Math.max(m, n.inicio + n.duracion), 4),
        ),
      })
      setDirty(false)
    },
    [tienda, trackId, clipId, clip?.duracion],
  )

  const previewNote = (pitch: number, velocity = 90) => audioEngine.noteOn(pitch, velocity)
  const releaseNote = (pitch: number) => audioEngine.noteOff(pitch)

  // Playhead relativo al clip (beats)
  const clipStartBeat = clip?.inicio ?? 0
  const playheadBeat = (transportSec * bpm) / 60 - clipStartBeat
  const showPlayhead = playheadBeat >= -0.05 && playheadBeat <= durationBeats + 0.05

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
    const next = notesRef.current.map((n) => {
      if (ids.size > 0 && !ids.has(n.id)) return n
      return { ...n, inicio: snapBeat(n.inicio) }
    })
    setNotes(next)
    setDirty(true)
    void persist(next)
  }, [persist, snapBeat])

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
        void (async () => {
          if (soloClip && !isPlaying) {
            const startSec = ((clip?.inicio ?? 0) * 60) / Math.max(1, bpm)
            await tienda.executor.execute('transport.seek', { segundos: startSec })
          }
          await tienda.executor.execute('transport.toggle', {})
        })()
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
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    isPlaying,
    clip,
    bpm,
    tienda,
  ])

  if (!clip || clip.tipo !== 'midi') {
    return (
      <div className="flex h-full items-center justify-center bg-panel text-[12px] text-muted-foreground">
        Clip MIDI no encontrado
      </div>
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
        onDuplicate={duplicateSelected}
        onDelete={deleteSelected}
        onTranspose={transposeSelected}
        onNudge={nudgeSelected}
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
      />

      <div className="flex min-h-0 flex-1">
        <div className="w-14 shrink-0 overflow-hidden border-r border-border bg-panel-raised">
          <div style={{ height: gridHeight }}>
            {Array.from({ length: KEYS }).map((_, i) => {
              const pitch = HIGHEST - i
              const black = isBlack(pitch)
              const active = heldKey === pitch
              const selectedHere = [...selectedIds].some((id) => notes.find((n) => n.id === id)?.pitch === pitch)
              return (
                <button
                  key={pitch}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
                    setHeldKey(pitch)
                    previewNote(pitch, 100)
                  }}
                  onPointerUp={() => {
                    setHeldKey(null)
                    releaseNote(pitch)
                  }}
                  onPointerCancel={() => {
                    setHeldKey(null)
                    releaseNote(pitch)
                  }}
                  className={`flex w-full items-center justify-end border-b border-border/40 pr-1 font-mono text-[9px] ${
                    active
                      ? 'bg-accent-amber/40 text-foreground'
                      : selectedHere
                        ? 'bg-accent-amber/15'
                        : black
                          ? 'bg-background/80 text-muted-foreground hover:bg-accent-amber/20'
                          : 'bg-panel-raised text-foreground hover:bg-accent-amber/15'
                  }`}
                  style={{ height: keyH }}
                  title={`${noteName(pitch)} · MIDI ${pitch}`}
                >
                  {pitch % 12 === 0 ? noteName(pitch) : ''}
                </button>
              )
            })}
          </div>
        </div>

        <div ref={scrollRef} className="min-w-0 flex-1 overflow-auto">
          <PianoRollTimelineRuler
            pxPerBeat={pxPerBeat}
            durationBeats={durationBeats}
            beatsPerBar={beatsPerBar}
            clipInicioBeats={clip.inicio ?? 0}
            onSeekBeats={(absBeats) => {
              const sec = (absBeats * 60) / Math.max(1, bpm)
              void tienda.executor.execute('transport.seek', { segundos: sec })
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
                  const beatsFromBar = (i * line.spacingBeats) % 4
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

            {showPlayhead && (
              <div
                className={`pointer-events-none absolute top-0 z-20 w-px ${isPlaying ? 'bg-accent-amber' : 'bg-foreground/50'}`}
                style={{ left: playheadBeat * pxPerBeat, height: gridHeight + velLaneH }}
              />
            )}

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
                onHit={(id, ev) => {
                  if (!id) return
                  const n = notes.find((x) => x.id === id)
                  if (!n) return
                  if (herramienta === 'borrar') {
                    const next = notes.filter((x) => x.id !== id)
                    setNotes(next)
                    setDirty(true)
                    void persist(next)
                    return
                  }
                  setSelectedIds((prev) => {
                    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
                      const next = new Set(prev)
                      if (next.has(id)) next.delete(id)
                      else next.add(id)
                      return next
                    }
                    return new Set([id])
                  })
                  previewNote(n.pitch, n.velocidad)
                  window.setTimeout(() => releaseNote(n.pitch), 160)
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
                  onClick={(e) => {
                    e.stopPropagation()
                    if (herramienta === 'borrar') {
                      const next = notes.filter((x) => x.id !== n.id)
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
                    setSelectedIds((prev) => {
                      if (e.shiftKey || e.ctrlKey || e.metaKey) {
                        const next = new Set(prev)
                        if (next.has(n.id)) next.delete(n.id)
                        else next.add(n.id)
                        return next
                      }
                      return new Set([n.id])
                    })
                    previewNote(n.pitch, n.velocidad)
                    window.setTimeout(() => releaseNote(n.pitch), 180)
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return
                    e.stopPropagation()
                    if (herramienta === 'borrar') return
                    const edge = e.clientX - e.currentTarget.getBoundingClientRect().left > width - 6
                    const ids =
                      selectedIds.has(n.id) && selectedIds.size > 0
                        ? selectedIds
                        : new Set([n.id])
                    setSelectedIds(ids)
                    previewNote(n.pitch, n.velocidad)
                    const startX = e.clientX
                    const startY = e.clientY
                    const origins = new Map(
                      notes.filter((x) => ids.has(x.id)).map((x) => [x.id, { ...x }]),
                    )
                    const move = (ev: PointerEvent) => {
                      const dx = ev.clientX - startX
                      const dy = ev.clientY - startY
                      setNotes((prev) =>
                        prev.map((x) => {
                          const o = origins.get(x.id)
                          if (!o) return x
                          if (edge && ids.size === 1) {
                            return {
                              ...x,
                              duracion: Math.max(snapDiv / 2, snapBeat(o.duracion + dx / pxPerBeat)),
                            }
                          }
                          return {
                            ...x,
                            inicio: snapBeat(o.inicio + dx / pxPerBeat),
                            pitch: Math.max(
                              LOWEST,
                              Math.min(HIGHEST, o.pitch - Math.round(dy / keyH)),
                            ),
                          }
                        }),
                      )
                      setDirty(true)
                    }
                    const up = () => {
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', up)
                      releaseNote(n.pitch)
                      setNotes((prev) => {
                        void persist(prev)
                        return prev
                      })
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', up)
                  }}
                  className={`absolute z-10 rounded-sm border ${
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
                  <span className="absolute right-0 top-0 h-full w-1.5 cursor-e-resize rounded-r-sm bg-white/20" />
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
        </div>
      </div>

      {showExpression && (
        <PianoRollExpressionLanes
          width={gridWidth}
          durationBeats={durationBeats}
          pxPerBeat={pxPerBeat}
          expression={clip.expression}
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

            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Plus className="size-3" /> Doble clic o modo Dibujar = crear nota · Alt+arrastrar = duracion · Lasso = seleccionar
        </span>
        <span>Pulsa ? para ver atajos · V/D/E herramientas · Supr borrar</span>
      </div>
    </div>
  )
}

export function PianoRollToolPanel() {
  const trackId = useDAWState((s: DAWState) => {
    const tracks = s.project?.tracks ?? []
    const sel = s.selection
    const clipId = sel?.idsClips?.[0]
    if (clipId) {
      for (const t of tracks) {
        const c = (t.clips ?? []).find((x) => x.id === clipId)
        if (c && (c as { tipo?: string }).tipo === 'midi') return t.id
      }
    }
    const preferredTrack = sel?.idPrincipal ?? sel?.idsPistas?.[0]
    if (preferredTrack) {
      const t = tracks.find((x) => x.id === preferredTrack)
      const midiClip = (t?.clips ?? []).find((c) => (c as { tipo?: string }).tipo === 'midi')
      if (t && midiClip) return t.id
    }
    for (const t of tracks) {
      const midiClip = (t.clips ?? []).find((c) => (c as { tipo?: string }).tipo === 'midi')
      if (midiClip) return t.id
    }
    return null
  })

  const clipId = useDAWState((s: DAWState) => {
    const tracks = s.project?.tracks ?? []
    const sel = s.selection
    const selectedClip = sel?.idsClips?.[0]
    if (selectedClip) {
      for (const t of tracks) {
        const c = (t.clips ?? []).find((x) => x.id === selectedClip)
        if (c && (c as { tipo?: string }).tipo === 'midi') return c.id
      }
    }
    const preferredTrack = sel?.idPrincipal ?? sel?.idsPistas?.[0]
    if (preferredTrack) {
      const t = tracks.find((x) => x.id === preferredTrack)
      const midiClip = (t?.clips ?? []).find((c) => (c as { tipo?: string }).tipo === 'midi')
      if (midiClip) return midiClip.id
    }
    for (const t of tracks) {
      const midiClip = (t.clips ?? []).find((c) => (c as { tipo?: string }).tipo === 'midi')
      if (midiClip) return midiClip.id
    }
    return null
  })

  if (!trackId || !clipId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-panel px-4 text-center">
        <Piano className="size-8 text-muted-foreground/40" />
        <p className="text-[12px] font-semibold text-foreground">Piano roll</p>
        <p className="max-w-[260px] text-[11px] text-muted-foreground">
          Selecciona o crea un clip MIDI (doble clic en el arrange) para editar las notas aqui. Usa la barra de herramientas y pulsa ? para ver los atajos.
        </p>
      </div>
    )
  }

  return <PianoRoll trackId={trackId} clipId={clipId} />
}

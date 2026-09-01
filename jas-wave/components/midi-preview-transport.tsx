/**
 * Transporto de vista previa MIDI: timeline clicable, playhead y Configurar VST.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Play, SlidersHorizontal, Square } from 'lucide-react'
import {
  openPreviewPluginEditor,
  playMidiPreviewAudition,
  stopMidiPreviewAudition,
  type PreviewMidiNote,
} from '@/src/lib/midi-preview-audition'
import { beatsASegundos } from '@/lib/audio-conversions'
import type { PluginInfo } from '../../shared/src/types/entidades'

type Props = {
  notes: PreviewMidiNote[]
  bpm: number
  /** Duración visible en beats (default: fin de la última nota). */
  durationBeats?: number
  pluginId?: string | null
  pluginNombre?: string | null
  rol?: string | null
  trackId?: string | null
  trackNombre?: string | null
  trackPlugins?: PluginInfo[] | null
  candidateTrackIds?: string[]
  heightClass?: string
  disabled?: boolean
}

function formatBeat(b: number): string {
  const bar = Math.floor(b / 4) + 1
  const beat = Math.floor(b % 4) + 1
  return `${bar}.${beat}`
}

export function MidiPreviewTransport({
  notes,
  bpm,
  durationBeats: durationBeatsProp,
  pluginId,
  pluginNombre,
  rol,
  trackId,
  trackNombre,
  trackPlugins,
  candidateTrackIds,
  heightClass = 'h-24',
  disabled,
}: Props) {
  const [playing, setPlaying] = useState(false)
  const [cursorBeat, setCursorBeat] = useState(0)
  const [playheadBeat, setPlayheadBeat] = useState(0)
  const [hint, setHint] = useState('')
  const [openingEditor, setOpeningEditor] = useState(false)
  const playStartedAt = useRef(0)
  const playFromBeat = useRef(0)
  const playDurBeats = useRef(0)
  const railRef = useRef<HTMLDivElement>(null)

  const durationBeats = useMemo(() => {
    if (durationBeatsProp && durationBeatsProp > 0) return durationBeatsProp
    if (!notes.length) return 8
    return Math.max(4, ...notes.map((n) => n.inicio + n.duracion))
  }, [durationBeatsProp, notes])

  const dots = useMemo(() => {
    const max = 140
    const step = Math.max(1, Math.floor(notes.length / max))
    return notes.filter((_, i) => i % step === 0).slice(0, max)
  }, [notes])

  const stop = useCallback(() => {
    stopMidiPreviewAudition()
    setPlaying(false)
    setPlayheadBeat(cursorBeat)
  }, [cursorBeat])

  useEffect(() => () => stopMidiPreviewAudition(), [])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const elapsedSec = (performance.now() - playStartedAt.current) / 1000
      const elapsedBeats = (elapsedSec * bpm) / 60
      const pos = playFromBeat.current + elapsedBeats
      if (pos >= playFromBeat.current + playDurBeats.current) {
        setPlaying(false)
        setPlayheadBeat(cursorBeat)
        return
      }
      setPlayheadBeat(Math.min(durationBeats, pos))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, bpm, cursorBeat, durationBeats])

  const playFrom = useCallback(
    async (fromBeat: number) => {
      if (disabled || !notes.length) return
      stopMidiPreviewAudition()
      setPlaying(true)
      setHint('Cargando…')
      playFromBeat.current = fromBeat
      setPlayheadBeat(fromBeat)
      playStartedAt.current = performance.now()
      try {
        const result = await playMidiPreviewAudition({
          notes,
          bpm,
          startBeat: fromBeat,
          trackId,
          trackNombre,
          trackPlugins,
          candidateTrackIds,
          pluginId,
          pluginNombre,
          rol,
          preferHost: true,
          webMonitor: false,
          onEnded: () => {
            setPlaying(false)
            setPlayheadBeat(fromBeat)
          },
        })
        playDurBeats.current = result.durationBeats
        setHint(result.message)
        playStartedAt.current = performance.now()
      } catch (err) {
        setPlaying(false)
        setHint(err instanceof Error ? err.message : 'No se pudo reproducir')
      }
    },
    [
      bpm,
      candidateTrackIds,
      disabled,
      notes,
      pluginId,
      pluginNombre,
      rol,
      trackId,
      trackNombre,
      trackPlugins,
    ],
  )

  const onRailClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = railRef.current
      if (!el || disabled) return
      const rect = el.getBoundingClientRect()
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
      const beat = x * durationBeats
      setCursorBeat(beat)
      setPlayheadBeat(beat)
      if (playing) void playFrom(beat)
    },
    [disabled, durationBeats, playFrom, playing],
  )

  const openEditor = useCallback(async () => {
    setOpeningEditor(true)
    setHint('Abriendo editor VST…')
    try {
      const r = await openPreviewPluginEditor({
        pluginId,
        pluginNombre,
        rol,
        trackId,
        candidateTrackIds,
        trackPlugins,
      })
      setHint(r.message)
    } finally {
      setOpeningEditor(false)
    }
  }, [candidateTrackIds, pluginId, pluginNombre, rol, trackId, trackPlugins])

  const headPct = (Math.max(0, Math.min(durationBeats, playing ? playheadBeat : cursorBeat)) / durationBeats) * 100
  const secs = beatsASegundos(durationBeats, bpm)

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || !notes.length}
          onClick={() => void (playing ? stop() : playFrom(cursorBeat))}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] font-medium hover:bg-muted/40 disabled:opacity-40"
        >
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
          {playing ? 'Stop' : cursorBeat > 0.05 ? `Desde ${formatBeat(cursorBeat)}` : 'Escuchar'}
        </button>
        <button
          type="button"
          disabled={disabled || openingEditor}
          onClick={() => void openEditor()}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] hover:bg-muted/40 disabled:opacity-40"
          title="Abrir UI del VST para ajustar el sonido"
        >
          {openingEditor ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <SlidersHorizontal className="size-3" />
          )}
          Configurar VST
        </button>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {formatBeat(playing ? playheadBeat : cursorBeat)} / {formatBeat(durationBeats)} ·{' '}
          {secs.toFixed(1)}s
        </span>
      </div>

      <div
        ref={railRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={durationBeats}
        aria-valuenow={playing ? playheadBeat : cursorBeat}
        tabIndex={0}
        onClick={onRailClick}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            const b = Math.min(durationBeats, cursorBeat + 1)
            setCursorBeat(b)
            setPlayheadBeat(b)
          } else if (e.key === 'ArrowLeft') {
            const b = Math.max(0, cursorBeat - 1)
            setCursorBeat(b)
            setPlayheadBeat(b)
          } else if (e.key === ' ') {
            e.preventDefault()
            void (playing ? stop() : playFrom(cursorBeat))
          }
        }}
        className={`relative ${heightClass} cursor-crosshair overflow-hidden rounded-lg border border-border/50 bg-background/40`}
      >
        {/* marcas de compás */}
        {Array.from({ length: Math.floor(durationBeats / 4) + 1 }, (_, i) => (
          <div
            key={i}
            className="absolute bottom-0 top-0 w-px bg-border/40"
            style={{ left: `${((i * 4) / durationBeats) * 100}%` }}
          />
        ))}
        {dots.map((n, i) => {
          const x = (n.inicio / durationBeats) * 100
          const w = Math.max(0.4, (n.duracion / durationBeats) * 100)
          const y = ((127 - n.pitch) / 127) * 100
          return (
            <div
              key={i}
              className="pointer-events-none absolute rounded-[1px] bg-accent-amber/75"
              style={{
                left: `${x}%`,
                width: `${w}%`,
                top: `${Math.max(4, Math.min(90, y))}%`,
                height: 3,
              }}
            />
          )
        })}
        {!dots.length ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            Sin notas
          </div>
        ) : null}
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.8)]"
          style={{ left: `${headPct}%` }}
        />
      </div>

      <p className="text-[10px] text-muted-foreground">
        Clic en la timeline para elegir el inicio ·{' '}
        {hint || 'Escucha con el VST elegido (Plugin Host / ASIO).'}
      </p>
    </div>
  )
}

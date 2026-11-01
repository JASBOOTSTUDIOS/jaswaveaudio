/**
 * Transporte + regla de tiempo del piano roll (sincronizado con el DAW).
 * - Alinear timeline: playhead/seek siguen (o no) la ventana principal.
 * - Solo clip: al reproducir, cicla el rango del clip.
 */

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Play, Pause, Square, Repeat, Link2, Unlink, Magnet } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { usePlaybackActions } from '@/components/playback-provider'
import type { DAWState } from '../../shared/src/types/state'
import {
  formatRulerLabel,
  gridLevelsForZoom,
  pickZoomGridPrimary,
  zoomLevelRank,
} from '@/components/arrangement/timeline-grid-math'

function formatBarsBeats(beatsAbs: number, beatsPerBar: number): string {
  const bar = Math.floor(beatsAbs / beatsPerBar) + 1
  const beat = Math.floor(beatsAbs % beatsPerBar) + 1
  const tick = Math.floor(((beatsAbs % 1) + 1e-9) * 100)
  return `${bar}.${beat}.${String(tick).padStart(2, '0')}`
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = Math.floor(totalSec % 60)
  const cs = Math.floor((totalSec % 1) * 100)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

type Props = {
  clipInicioBeats: number
  clipDuracionBeats: number
  soloClip: boolean
  onSoloClipChange: (v: boolean) => void
  alignTimeline?: boolean
  onAlignTimelineChange?: (v: boolean) => void
  followPlayhead?: boolean
  onFollowPlayheadChange?: (v: boolean) => void
}

export function PianoRollTransport({
  clipInicioBeats,
  clipDuracionBeats,
  soloClip,
  onSoloClipChange,
  alignTimeline = true,
  onAlignTimelineChange,
  followPlayhead = true,
  onFollowPlayheadChange,
}: Props) {
  const tienda = useDAW()
  const transport = useDAWState((s: DAWState) => s.transport)
  const bpm = useDAWState((s: DAWState) => s.project?.bpm?.valor ?? 120)
  const beatsPerBar = useDAWState((s: DAWState) => s.project?.timeSignature?.numerador ?? 4)
  const playheadSnap = useDAWState((s: DAWState) => s.ui?.playheadSnap !== false)
  const { getPositionMs } = usePlaybackActions()

  const isPlaying = Boolean(transport?.reproduciendo)
  const msPerBeat = 60_000 / Math.max(1, bpm)

  const clipStartMs = clipInicioBeats * msPerBeat
  const clipEndMs = (clipInicioBeats + clipDuracionBeats) * msPerBeat

  const clockRef = useRef<HTMLSpanElement>(null)
  const barsRef = useRef<HTMLSpanElement>(null)
  const clipPosRef = useRef<HTMLSpanElement>(null)
  const syncLabelRef = useRef<HTMLSpanElement>(null)

  const loopingRef = useRef(false)
  const lastPosRef = useRef(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const positionMs = getPositionMs()
      const absBeats = positionMs / msPerBeat
      const relativeBeats = absBeats - clipInicioBeats
      if (clockRef.current) clockRef.current.textContent = formatClock(positionMs)
      if (barsRef.current) {
        barsRef.current.textContent = formatBarsBeats(Math.max(0, absBeats), beatsPerBar)
      }
      if (clipPosRef.current) {
        clipPosRef.current.textContent =
          relativeBeats >= 0 ? formatBarsBeats(relativeBeats, beatsPerBar) : '—'
      }

      if (alignTimeline && soloClip && isPlaying) {
        const prev = lastPosRef.current
        lastPosRef.current = positionMs
        const crossed = prev < clipEndMs - 8 && positionMs >= clipEndMs - 8
        if (crossed && !loopingRef.current) {
          loopingRef.current = true
          void tienda.executor.execute('transport.seek', { segundos: clipStartMs / 1000 }).finally(() => {
            loopingRef.current = false
          })
        }
      } else {
        lastPosRef.current = positionMs
        loopingRef.current = false
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [
    getPositionMs,
    msPerBeat,
    clipInicioBeats,
    beatsPerBar,
    soloClip,
    alignTimeline,
    isPlaying,
    clipEndMs,
    clipStartMs,
    tienda,
  ])

  const play = async () => {
    if (alignTimeline && soloClip) {
      await tienda.executor.execute('transport.seek', { segundos: clipStartMs / 1000 })
    }
    if (!isPlaying) {
      await tienda.executor.execute('transport.toggle', {})
    }
  }

  const pause = async () => {
    if (isPlaying) await tienda.executor.execute('transport.toggle', {})
  }

  const stop = async () => {
    await tienda.executor.execute('transport.stop', {})
    if (alignTimeline && soloClip) {
      await tienda.executor.execute('transport.seek', { segundos: clipStartMs / 1000 })
    }
  }

  const togglePlayheadSnap = () => {
    tienda.establecerEstado((s: DAWState) => ({
      ...s,
      ui: { ...s.ui, playheadSnap: !(s.ui?.playheadSnap !== false) },
    }))
  }

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-panel-raised/40 px-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          title={isPlaying ? 'Pausar (Espacio)' : 'Reproducir (Espacio) — transporte global'}
          onClick={() => void (isPlaying ? pause() : play())}
          className={`flex size-7 items-center justify-center rounded ${
            isPlaying ? 'bg-track-fx/20 text-track-fx' : 'text-foreground hover:bg-panel-raised'
          }`}
        >
          {isPlaying ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
        </button>
        <button
          type="button"
          title="Detener (Enter)"
          onClick={() => void stop()}
          className="flex size-7 items-center justify-center rounded text-foreground hover:bg-panel-raised"
        >
          <Square className="size-3" fill="currentColor" />
        </button>
      </div>

      <div className="flex items-center gap-2 rounded bg-background px-2 py-0.5 font-mono text-[11px] tabular-nums ring-1 ring-border">
        <span ref={clockRef} className="text-foreground">
          {formatClock(getPositionMs())}
        </span>
        <span className="text-muted-foreground">|</span>
        <span ref={barsRef} className="text-foreground">
          {formatBarsBeats(Math.max(0, getPositionMs() / msPerBeat), beatsPerBar)}
        </span>
        <span className="text-[9px] text-muted-foreground">
          clip{' '}
          <span ref={clipPosRef}>—</span>
        </span>
      </div>

      {onAlignTimelineChange && (
        <label
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold ${
            alignTimeline
              ? 'bg-track-fx/15 text-track-fx'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
          title={
            alignTimeline
              ? 'Timeline alineada con el DAW: seek y playhead siguen la ventana principal'
              : 'Timeline libre: seek solo mueve el playhead local del piano roll'
          }
        >
          <input
            type="checkbox"
            className="size-3 accent-current"
            checked={alignTimeline}
            onChange={(e) => onAlignTimelineChange(e.target.checked)}
          />
          Alinear con DAW
        </label>
      )}

      <button
        type="button"
        title={
          soloClip
            ? 'Loop del clip: ON — al reproducir cicla el rango del clip'
            : 'Loop del clip: OFF'
        }
        onClick={() => onSoloClipChange(!soloClip)}
        disabled={!alignTimeline}
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-40 ${
          soloClip
            ? 'bg-accent-amber/20 text-accent-amber'
            : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
        }`}
      >
        {soloClip ? <Unlink className="size-3" /> : <Link2 className="size-3" />}
        {soloClip ? 'Loop clip' : 'Song'}
      </button>

      {onFollowPlayheadChange && (
        <button
          type="button"
          title="Seguir playhead al reproducir"
          onClick={() => onFollowPlayheadChange(!followPlayhead)}
          disabled={!alignTimeline}
          className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-40 ${
            followPlayhead
              ? 'bg-track-fx/20 text-track-fx'
              : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
          }`}
        >
          Follow
        </button>
      )}

      <button
        type="button"
        onClick={togglePlayheadSnap}
        aria-pressed={playheadSnap}
        title={
          playheadSnap
            ? 'Imán ON: seek anclado a la profundidad de encaje'
            : 'Imán OFF: seek libre (sin anclar a la rejilla)'
        }
        className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold ${
          playheadSnap
            ? 'bg-accent-amber/20 text-accent-amber'
            : 'text-muted-foreground hover:bg-panel-raised hover:text-foreground'
        }`}
      >
        <Magnet className="size-3" />
        Magnet
      </button>

      <span ref={syncLabelRef} className="ml-auto flex items-center gap-1 text-[9px] text-muted-foreground">
        <Repeat className="size-3" />
        {alignTimeline
          ? soloClip
            ? 'Transporte global · loop del clip'
            : 'Transporte y timeline del DAW'
          : 'Transporte global · timeline libre'}
      </span>
    </div>
  )
}

/** Regla temporal: 3 niveles según zoom (paridad TimelineRuler del arrange). */
export function PianoRollTimelineRuler({
  pxPerBeat,
  durationBeats,
  beatsPerBar = 4,
  clipInicioBeats = 0,
  clipDurationBeats,
  height = 22,
  onSeekBeats,
  snapDivision = 0,
}: {
  pxPerBeat: number
  durationBeats: number
  beatsPerBar?: number
  clipInicioBeats?: number
  /** Si se indica, marca el final del clip dentro de la timeline extendida. */
  clipDurationBeats?: number
  height?: number
  onSeekBeats?: (absoluteBeats: number) => void
  /** Profundidad máxima (snap). */
  snapDivision?: number
}) {
  const width = durationBeats * pxPerBeat
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tooltip, setTooltip] = useState<string | null>(null)
  const draggingRef = useRef(false)
  const clipEnd = clipDurationBeats != null ? Math.min(clipDurationBeats, durationBeats) : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const primary = pickZoomGridPrimary(pxPerBeat, beatsPerBar, snapDivision)
    const levels = gridLevelsForZoom(pxPerBeat, beatsPerBar, snapDivision)

    for (const level of levels) {
      const step = level.spacingBeats
      if (step * pxPerBeat < 2) continue
      const rank = zoomLevelRank(step, primary)
      if (rank < 0) continue
      const count = Math.ceil(durationBeats / step) + 1
      for (let i = 0; i < count; i++) {
        const b = i * step
        if (b > durationBeats + 1e-9) break
        if (rank > 0) {
          const coarser = rank === 1 ? primary : primary / 2
          const mod = ((b % coarser) + coarser) % coarser
          if (mod < 1e-6) continue
        }
        const x = b * pxPerBeat
        const pastClip = clipEnd != null && b > clipEnd + 1e-9
        const tickTop = rank === 0 ? height * 0.16 : rank === 1 ? height * 0.34 : height * 0.5
        ctx.globalAlpha = pastClip
          ? rank === 0
            ? 0.45
            : rank === 1
              ? 0.28
              : 0.18
          : rank === 0
            ? 0.92
            : rank === 1
              ? 0.58
              : 0.38
        ctx.strokeStyle = 'rgb(125, 211, 252)'
        ctx.lineWidth = rank === 0 ? 1.7 : rank === 1 ? 1.25 : 1
        ctx.beginPath()
        ctx.moveTo(x + 0.5, tickTop)
        ctx.lineTo(x + 0.5, height)
        ctx.stroke()
        ctx.globalAlpha = 1

        if (rank === 0 && step * pxPerBeat >= 22) {
          ctx.fillStyle = pastClip ? 'rgba(125, 211, 252, 0.45)' : 'rgba(125, 211, 252, 0.95)'
          ctx.font = '600 9px ui-monospace, monospace'
          ctx.textBaseline = 'top'
          ctx.fillText(formatRulerLabel(b, beatsPerBar, step), x + 3, 2)
        }
      }
    }

    if (clipEnd != null && clipEnd < durationBeats - 1e-6) {
      const x = clipEnd * pxPerBeat
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.85)'
      ctx.setLineDash([4, 3])
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(x + 0.5, 0)
      ctx.lineTo(x + 0.5, height)
      ctx.stroke()
      ctx.setLineDash([])
    }
  }, [width, height, pxPerBeat, durationBeats, beatsPerBar, snapDivision, clipEnd])

  const seekFromClientX = (clientX: number) => {
    if (!onSeekBeats || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const rel = Math.max(0, Math.min(durationBeats, x / pxPerBeat))
    const abs = clipInicioBeats + rel
    onSeekBeats(abs)
    const bar = Math.floor(abs / beatsPerBar) + 1
    const beat = Math.floor(abs % beatsPerBar) + 1
    setTooltip(`${bar}.${beat}`)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!onSeekBeats || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    draggingRef.current = true
    seekFromClientX(e.clientX)

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return
      seekFromClientX(ev.clientX)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      draggingRef.current = false
      setTooltip(null)
      try {
        ;(e.target as HTMLElement)?.releasePointerCapture?.(ev.pointerId)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative shrink-0" style={{ width, height }}>
      <canvas
        ref={canvasRef}
        className="relative block cursor-ew-resize border-b border-border bg-panel-raised"
        title="Clic / arrastrar para buscar en el tiempo"
        onPointerDown={onPointerDown}
      />
      {tooltip && (
        <div className="pointer-events-none absolute left-1/2 top-full z-30 -translate-x-1/2 rounded bg-background px-1.5 py-0.5 font-mono text-[10px] text-accent-amber shadow ring-1 ring-border">
          {tooltip}
        </div>
      )}
    </div>
  )
}

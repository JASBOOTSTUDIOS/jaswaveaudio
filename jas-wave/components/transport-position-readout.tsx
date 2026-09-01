import { useEffect, useRef } from 'react'
import { usePlaybackActions } from '@/components/playback-provider'
import { msATiempoFormateado, msACompasBeat } from '@/lib/audio-conversions'

/**
 * Timecode + compás fluidos vía RAF (sin setState).
 * Evita el salto de ~10fps del PlaybackClockContext.
 */
export function TransportPositionReadout({
  bpm,
  beatsPerBar,
}: {
  bpm: number
  beatsPerBar: number
}) {
  const { getPositionMs } = usePlaybackActions()
  const timeRef = useRef<HTMLSpanElement>(null)
  const barBeatRef = useRef<HTMLSpanElement>(null)
  const beatMarksRef = useRef<HTMLDivElement>(null)
  const bpmRef = useRef(bpm)
  const bpbRef = useRef(beatsPerBar)
  bpmRef.current = bpm
  bpbRef.current = beatsPerBar

  useEffect(() => {
    let raf = 0
    let lastMs = -1
    let lastBeat = -1

    const tick = () => {
      const ms = getPositionMs()
      // Actualizar milis cada frame; saltear si no cambió ≥1ms
      if (Math.abs(ms - lastMs) >= 1) {
        lastMs = ms
        if (timeRef.current) {
          timeRef.current.textContent = msATiempoFormateado(ms)
        }
        const { compas, beat } = msACompasBeat(ms, bpmRef.current, bpbRef.current)
        if (barBeatRef.current) {
          barBeatRef.current.textContent = `${compas} | ${beat}`
        }
        if (beat !== lastBeat && beatMarksRef.current) {
          lastBeat = beat
          const marks = beatMarksRef.current.children
          for (let i = 0; i < marks.length; i++) {
            const el = marks[i] as HTMLElement
            if (el.dataset.beat === String(beat)) {
              el.classList.add('text-accent-amber')
              el.classList.remove('text-muted-foreground')
            } else {
              el.classList.remove('text-accent-amber')
              el.classList.add('text-muted-foreground')
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getPositionMs])

  const initialMs = getPositionMs()
  const { compas, beat } = msACompasBeat(initialMs, bpm, beatsPerBar)

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg bg-background px-3 py-1.5 ring-1 ring-border">
        <span
          ref={timeRef}
          className="font-mono text-[22px] font-semibold tabular-nums tracking-tight text-foreground"
        >
          {msATiempoFormateado(initialMs)}
        </span>
        <div className="flex flex-col gap-0.5 text-[9px] uppercase leading-none text-muted-foreground">
          <span className="rounded bg-panel-raised px-1 py-0.5 text-foreground">min:sec</span>
          <span ref={barBeatRef} className="px-1 py-0.5">
            {compas} | {beat}
          </span>
        </div>
      </div>

      <div
        ref={beatMarksRef}
        className="flex items-center gap-1 font-mono text-[13px] text-muted-foreground"
      >
        {Array.from({ length: beatsPerBar }, (_, i) => i + 1).map((n) => (
          <span
            key={n}
            data-beat={n}
            className={n === beat ? 'text-accent-amber' : 'text-muted-foreground'}
          >
            {n}
          </span>
        ))}
      </div>
    </>
  )
}

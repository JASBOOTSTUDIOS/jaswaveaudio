/**
 * Playhead HF: un RAF estable; callbacks vía refs para no reiniciar el loop
 * cuando React recrea beatToPixel / getSeconds.
 *
 * mode:
 * - content: X = beatToPixel(beat) dentro de un ancestro que scrollea
 * - viewport: X = beat*ppb - getScrollX() (regla / overlay unificado)
 */
import { useEffect, useRef } from 'react'

export function PlayheadOverlay({
  contentLeftPx,
  getSeconds,
  bpm,
  beatToPixel,
  getScrollX,
  pixelsPerBeat,
  mode = 'content',
  showTooltip,
  tooltipLabel,
  onPointerDown,
}: {
  contentLeftPx?: number
  getSeconds?: () => number
  bpm?: number
  beatToPixel?: (beat: number) => number
  /** Lectura viva del scroll (p.ej. lanesScrollRef.current.scrollLeft). */
  getScrollX?: () => number
  pixelsPerBeat?: number
  mode?: 'content' | 'viewport'
  showTooltip?: boolean
  tooltipLabel?: string
  onPointerDown?: (e: React.PointerEvent) => void
}) {
  const lineRef = useRef<HTMLDivElement>(null)
  const getSecondsRef = useRef(getSeconds)
  const bpmRef = useRef(bpm)
  const beatToPixelRef = useRef(beatToPixel)
  const getScrollXRef = useRef(getScrollX)
  const ppbRef = useRef(pixelsPerBeat)
  const modeRef = useRef(mode)
  getSecondsRef.current = getSeconds
  bpmRef.current = bpm
  beatToPixelRef.current = beatToPixel
  getScrollXRef.current = getScrollX
  ppbRef.current = pixelsPerBeat
  modeRef.current = mode

  useEffect(() => {
    const el = lineRef.current
    if (!el) return

    const resolveX = (beat: number): number | null => {
      if (modeRef.current === 'viewport') {
        const ppb = ppbRef.current
        if (ppb == null || !(ppb > 0)) return null
        const sx = getScrollXRef.current?.() ?? 0
        return beat * ppb - sx
      }
      const btp = beatToPixelRef.current
      return btp ? btp(beat) : null
    }

    if (!getSecondsRef.current || bpmRef.current == null) {
      if (contentLeftPx != null) {
        el.style.transform = `translate3d(${contentLeftPx}px, 0, 0)`
      }
      return
    }

    let raf = 0
    let lastX = -1
    const tick = () => {
      const gs = getSecondsRef.current
      const b = bpmRef.current
      if (gs && b != null) {
        const beat = Math.max(0, (gs() * b) / 60)
        const x = resolveX(beat)
        if (x != null && Math.abs(x - lastX) >= 0.25) {
          lastX = x
          el.style.transform = `translate3d(${x}px, 0, 0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [contentLeftPx, Boolean(getSeconds), mode])

  const initialBeat =
    getSeconds && bpm != null ? Math.max(0, (getSeconds() * bpm) / 60) : 0
  const initial =
    contentLeftPx ??
    (mode === 'viewport' && pixelsPerBeat != null
      ? initialBeat * pixelsPerBeat - (getScrollX?.() ?? 0)
      : beatToPixel
        ? beatToPixel(initialBeat)
        : 0)

  return (
    <div
      ref={lineRef}
      className="pointer-events-auto absolute top-0 bottom-0 z-30 w-0.5 cursor-ew-resize bg-accent-amber will-change-transform"
      style={{ left: 0, transform: `translate3d(${initial}px, 0, 0)` }}
      onPointerDown={onPointerDown}
    >
      <div className="absolute -left-1.5 top-0 size-3 rounded-full bg-accent-amber" />
      {showTooltip && tooltipLabel && (
        <div className="absolute left-2 top-1 whitespace-nowrap rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-foreground shadow">
          {tooltipLabel}
        </div>
      )}
    </div>
  )
}

import { useEffect, useRef } from 'react'

/**
 * Playhead HF: un RAF estable; callbacks vía refs para no reiniciar el loop
 * cuando React recrea beatToPixel / getSeconds.
 */
export function PlayheadOverlay({
  contentLeftPx,
  getSeconds,
  bpm,
  beatToPixel,
  showTooltip,
  tooltipLabel,
  onPointerDown,
}: {
  contentLeftPx?: number
  getSeconds?: () => number
  bpm?: number
  beatToPixel?: (beat: number) => number
  showTooltip?: boolean
  tooltipLabel?: string
  onPointerDown?: (e: React.PointerEvent) => void
}) {
  const lineRef = useRef<HTMLDivElement>(null)
  const getSecondsRef = useRef(getSeconds)
  const bpmRef = useRef(bpm)
  const beatToPixelRef = useRef(beatToPixel)
  getSecondsRef.current = getSeconds
  bpmRef.current = bpm
  beatToPixelRef.current = beatToPixel

  useEffect(() => {
    const el = lineRef.current
    if (!el) return

    if (!getSecondsRef.current || bpmRef.current == null || !beatToPixelRef.current) {
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
      const btp = beatToPixelRef.current
      if (gs && b != null && btp) {
        const beat = Math.max(0, (gs() * b) / 60)
        const x = btp(beat)
        if (Math.abs(x - lastX) >= 0.25) {
          lastX = x
          el.style.transform = `translate3d(${x}px, 0, 0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [contentLeftPx, Boolean(getSeconds)])

  const initial =
    contentLeftPx ??
    (getSeconds && bpm != null && beatToPixel
      ? beatToPixel(Math.max(0, (getSeconds() * bpm) / 60))
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

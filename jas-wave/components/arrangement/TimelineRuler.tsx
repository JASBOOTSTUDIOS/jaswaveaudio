import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { BASE_PIXELS_PER_BEAT } from './constants'

const MAX_CANVAS_EDGE = 4096

/** Regla sticky al viewport — no canvas del contentWidth completo. */
export function TimelineRuler({
  projection,
  zoom,
  beatsPerBar,
  viewportWidth,
  height = 40,
}: {
  projection: TimelineProjection
  zoom: number
  totalHeight?: number
  bpm?: number
  beatsPerBar: number
  contentWidth?: number
  viewportWidth: number
  height?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pxPerBeat = BASE_PIXELS_PER_BEAT * zoom
  const scrollX = projection.scrollX

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportWidth <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cssW = Math.max(1, Math.min(Math.floor(viewportWidth), MAX_CANVAS_EDGE))
    const cssH = height
    const bw = Math.floor(cssW * dpr)
    const bh = Math.floor(cssH * dpr)
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const muted =
      getComputedStyle(document.documentElement).getPropertyValue('--muted-foreground').trim() ||
      'rgba(160,160,160,0.9)'
    const line =
      getComputedStyle(document.documentElement).getPropertyValue('--grid-line').trim() ||
      'rgba(255,255,255,0.15)'

    const pxPerBar = pxPerBeat * beatsPerBar
    const { start: startBeat, end: endBeat } = projection.visibleBeatRange()
    const minBarSpacingPx = 36
    const barInterval =
      pxPerBar < minBarSpacingPx ? Math.max(1, Math.ceil(minBarSpacingPx / pxPerBar)) : 1

    const firstBar = Math.max(1, Math.floor(startBeat / beatsPerBar) - 1)
    const lastBar = Math.ceil(endBeat / beatsPerBar) + 2
    const toViewX = (beat: number) => projection.beatToPixel(beat) - scrollX

    ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    ctx.textBaseline = 'top'

    for (let bar = firstBar; bar <= lastBar; bar++) {
      const beatPos = (bar - 1) * beatsPerBar
      const x = Math.round(toViewX(beatPos)) + 0.5
      if (x < -40 || x > cssW + 40) continue

      const showLabel = (bar - 1) % barInterval === 0
      ctx.strokeStyle = line
      ctx.globalAlpha = showLabel ? 0.7 : 0.3
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
      ctx.stroke()
      ctx.globalAlpha = 1

      if (showLabel) {
        ctx.fillStyle = muted
        ctx.fillText(String(bar), x + 4, 2)
      }

      if (pxPerBeat > 14) {
        for (let b = 1; b < beatsPerBar; b++) {
          const bx = Math.round(toViewX(beatPos + b)) + 0.5
          if (bx < -2 || bx > cssW + 2) continue
          ctx.strokeStyle = line
          ctx.globalAlpha = 0.25
          ctx.beginPath()
          ctx.moveTo(bx, cssH * 0.35)
          ctx.lineTo(bx, cssH)
          ctx.stroke()
          ctx.globalAlpha = 1
          if (pxPerBeat > 40) {
            ctx.fillStyle = muted
            ctx.globalAlpha = 0.7
            ctx.fillText(`${bar}.${b + 1}`, bx + 3, 2)
            ctx.globalAlpha = 1
          }
        }
      }
    }
  }, [projection, zoom, beatsPerBar, viewportWidth, height, pxPerBeat, scrollX])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none sticky left-0 top-0 z-0"
      aria-hidden
    />
  )
}

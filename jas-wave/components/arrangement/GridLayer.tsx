import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { BASE_PIXELS_PER_BEAT } from './constants'

/** Límite seguro de bitmap (evitar canvas blanco / OOM al zoom). */
const MAX_CANVAS_EDGE = 4096

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Grid en canvas del **viewport** (sticky), no del contentWidth completo.
 * Al zoom alto el content puede tener cientos de miles de px — eso rompía el canvas.
 */
export function GridLayer({
  projection,
  zoom,
  beatsPerBar,
  viewportWidth,
  contentHeight,
}: {
  projection: TimelineProjection
  zoom: number
  beatsPerBar: number
  viewportWidth: number
  contentHeight: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pxPerBeat = BASE_PIXELS_PER_BEAT * zoom
  const scrollX = projection.scrollX

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportWidth <= 0 || contentHeight <= 0) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const cssW = Math.max(1, Math.min(Math.floor(viewportWidth), MAX_CANVAS_EDGE))
    const cssH = Math.max(1, Math.min(Math.floor(contentHeight), MAX_CANVAS_EDGE))
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

    const border = cssVar('--border', 'rgba(255,255,255,0.12)')
    const grid = cssVar('--grid-line', 'rgba(255,255,255,0.08)')

    type Level = { beat: number; minPx: number; alpha: number }
    const levels: Level[] = []
    if (pxPerBeat >= 80) {
      levels.push({ beat: 1 / 32, minPx: 4, alpha: 0.25 })
      levels.push({ beat: 1 / 16, minPx: 6, alpha: 0.35 })
      levels.push({ beat: 1 / 8, minPx: 10, alpha: 0.45 })
      levels.push({ beat: 1 / 4, minPx: 16, alpha: 0.55 })
      levels.push({ beat: 1 / 2, minPx: 24, alpha: 0.7 })
      levels.push({ beat: 1, minPx: 40, alpha: 0.9 })
    } else if (pxPerBeat >= 30) {
      levels.push({ beat: 1 / 16, minPx: 4, alpha: 0.3 })
      levels.push({ beat: 1 / 8, minPx: 6, alpha: 0.4 })
      levels.push({ beat: 1 / 4, minPx: 10, alpha: 0.5 })
      levels.push({ beat: 1 / 2, minPx: 16, alpha: 0.7 })
      levels.push({ beat: 1, minPx: 30, alpha: 0.9 })
    } else if (pxPerBeat >= 12) {
      levels.push({ beat: 1 / 8, minPx: 4, alpha: 0.3 })
      levels.push({ beat: 1 / 4, minPx: 6, alpha: 0.4 })
      levels.push({ beat: 1 / 2, minPx: 12, alpha: 0.65 })
      levels.push({ beat: 1, minPx: 20, alpha: 0.9 })
    } else if (pxPerBeat >= 5) {
      levels.push({ beat: 1 / 4, minPx: 4, alpha: 0.3 })
      levels.push({ beat: 1 / 2, minPx: 8, alpha: 0.45 })
      levels.push({ beat: 1, minPx: 14, alpha: 0.85 })
    } else {
      levels.push({ beat: 1, minPx: 10, alpha: 0.7 })
      if (pxPerBeat >= 2) levels.push({ beat: beatsPerBar, minPx: 40, alpha: 0.95 })
    }

    const { start: startBeat, end: endBeat } = projection.visibleBeatRange()
    const pad = beatsPerBar
    const from = Math.max(0, startBeat - pad)
    const to = endBeat + pad

    const toViewX = (beat: number) => projection.beatToPixel(beat) - scrollX

    for (const level of levels) {
      const pxPerSub = level.beat * pxPerBeat
      if (pxPerSub < level.minPx) continue
      const firstBeat = Math.floor(from / level.beat) * level.beat
      ctx.beginPath()
      for (let beat = firstBeat; beat <= to; beat += level.beat) {
        if (beat < 0) continue
        const isBar = Math.abs(beat % beatsPerBar) < 1e-9
        if (isBar && level.beat < beatsPerBar) continue
        const x = Math.round(toViewX(beat)) + 0.5
        if (x < -1 || x > cssW + 1) continue
        ctx.moveTo(x, 0)
        ctx.lineTo(x, cssH)
      }
      ctx.strokeStyle = grid
      ctx.globalAlpha = level.alpha
      ctx.lineWidth = 1
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    ctx.beginPath()
    const firstBarBeat = Math.floor(from / beatsPerBar) * beatsPerBar
    for (let beat = firstBarBeat; beat <= to; beat += beatsPerBar) {
      if (beat < 0) continue
      const x = Math.round(toViewX(beat)) + 0.5
      if (x < -1 || x > cssW + 1) continue
      ctx.moveTo(x, 0)
      ctx.lineTo(x, cssH)
    }
    ctx.strokeStyle = border
    ctx.globalAlpha = 0.85
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }, [projection, zoom, beatsPerBar, viewportWidth, contentHeight, pxPerBeat, scrollX])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute left-0 top-0 z-0"
      aria-hidden
    />
  )
}

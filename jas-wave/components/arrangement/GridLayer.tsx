import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { adaptiveGridForZoom } from '../../../shared/src/midi/grid'
import { BASE_PIXELS_PER_BEAT } from './constants'
import { beatToViewX, crispX, majorBarInterval } from './timeline-grid-math'

/** Límite seguro de bitmap (evitar canvas blanco / OOM al zoom). */
const MAX_CANVAS_EDGE = 8192
const MAX_LINES_PER_LEVEL = 12000

function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el
  while (cur) {
    const style = getComputedStyle(cur)
    const ox = style.overflowX
    if (ox === 'auto' || ox === 'scroll' || ox === 'overlay') return cur
    cur = cur.parentElement
  }
  return null
}

/**
 * Rejilla anclada al viewport de lanes — profundidad = adaptiveGridForZoom
 * (mismas divisiones a las que ancla el playhead).
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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || viewportWidth <= 0 || contentHeight <= 0) return

    const scroller = findScrollParent(canvas)
    let raf = 0

    const draw = (scrollX: number) => {
      canvas.style.left = `${scrollX}px`

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cssW = Math.max(1, Math.min(Math.ceil(viewportWidth), MAX_CANVAS_EDGE))
      const cssH = Math.max(1, Math.min(Math.ceil(contentHeight), MAX_CANVAS_EDGE))
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

      const border = cssVar('--border', 'rgba(255,255,255,0.22)')
      const grid = cssVar('--grid-line', 'rgba(255,255,255,0.14)')

      const pxPerBar = pxPerBeat * beatsPerBar
      const barInterval = majorBarInterval(pxPerBar, 36)
      const majorStep = beatsPerBar * barInterval
      const levels = adaptiveGridForZoom(pxPerBeat, beatsPerBar)

      const startBeat = scrollX / pxPerBeat
      const endBeat = (scrollX + cssW) / pxPerBeat
      const pad = Math.max(majorStep, beatsPerBar * 2)
      const from = Math.max(0, startBeat - pad)
      const to = endBeat + pad

      const toX = (beat: number) => crispX(beatToViewX(beat, pxPerBeat, scrollX))

      const strokeBeats = (
        stepBeats: number,
        alpha: number,
        color: string,
        opts?: { skipIfOnStep?: number },
      ) => {
        if (stepBeats <= 0 || !Number.isFinite(stepBeats)) return
        if (stepBeats * pxPerBeat < 1.25) return
        const first = Math.floor(from / stepBeats) * stepBeats
        const skipStep = opts?.skipIfOnStep ?? 0
        ctx.beginPath()
        let drawn = 0
        for (let n = 0; n < MAX_LINES_PER_LEVEL; n++) {
          const b = first + n * stepBeats
          if (b > to + 1e-9) break
          if (b < -1e-9) continue
          if (skipStep > 0) {
            const mod = ((b % skipStep) + skipStep) % skipStep
            if (mod < 1e-6 || Math.abs(mod - skipStep) < 1e-6) continue
          }
          const x = toX(b)
          if (x < -2 || x > cssW + 2) continue
          ctx.moveTo(x, 0)
          ctx.lineTo(x, cssH)
          drawn++
        }
        if (drawn === 0) return
        ctx.strokeStyle = color
        ctx.globalAlpha = alpha
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      // De fino a grueso: micros → beats → mayores
      const sorted = [...levels].sort((a, b) => a.spacingBeats - b.spacingBeats)
      for (const level of sorted) {
        if (level.spacingBeats >= majorStep) continue
        const alpha =
          level.kind === 'micro' ? 0.28 : level.kind === 'subdivision' ? 0.4 : 0.55
        strokeBeats(level.spacingBeats, alpha, grid, { skipIfOnStep: majorStep })
      }

      if (barInterval > 1 && pxPerBar >= 8) {
        strokeBeats(beatsPerBar, 0.5, grid, { skipIfOnStep: majorStep })
      }
      strokeBeats(majorStep, 0.95, border)
    }

    const sync = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const x = scroller?.scrollLeft ?? projection.scrollX
        draw(x)
      })
    }

    draw(scroller?.scrollLeft ?? projection.scrollX)
    scroller?.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    if (scroller) ro.observe(scroller)
    return () => {
      cancelAnimationFrame(raf)
      scroller?.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [projection.scrollX, projection, zoom, beatsPerBar, viewportWidth, contentHeight, pxPerBeat])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute top-0 z-0"
      aria-hidden
    />
  )
}

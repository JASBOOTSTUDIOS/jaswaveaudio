import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { BASE_PIXELS_PER_BEAT } from './constants'
import {
  beatToViewX,
  crispX,
  gridLevelsForZoom,
  pickZoomGridPrimary,
  zoomLevelRank,
} from './timeline-grid-math'

/** Límite seguro de bitmap (evitar canvas blanco / OOM al zoom). */
const MAX_CANVAS_EDGE = 8192
const MAX_LINES_PER_LEVEL = 12000

/** Azul claro visible sobre fondos oscuros. */
const GRID_BLUE = 'rgba(125, 211, 252, 1)'
const GRID_BLUE_SOFT = 'rgba(56, 189, 248, 1)'

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
 * Rejilla adaptativa al zoom: solo 3 niveles (primary, /2, /4).
 * Al alejar, primary crece (2, 4, 8, 16…) para no saturar.
 */
export function GridLayer({
  projection,
  zoom,
  beatsPerBar,
  viewportWidth,
  contentHeight,
  /** Profundidad máxima (snap): no dibujar más fino que esto. */
  snapDivision = 0,
}: {
  projection: TimelineProjection
  zoom: number
  beatsPerBar: number
  viewportWidth: number
  contentHeight: number
  snapDivision?: number
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

      const primary = pickZoomGridPrimary(pxPerBeat, beatsPerBar, snapDivision)
      const levels = gridLevelsForZoom(pxPerBeat, beatsPerBar, snapDivision)

      const startBeat = scrollX / pxPerBeat
      const endBeat = (scrollX + cssW) / pxPerBeat
      const pad = Math.max(primary * 2, beatsPerBar * 2)
      const from = Math.max(0, startBeat - pad)
      const to = endBeat + pad

      const toX = (beat: number) => crispX(beatToViewX(beat, pxPerBeat, scrollX))

      const strokeBeats = (
        stepBeats: number,
        alpha: number,
        color: string,
        opts?: { skipIfOnStep?: number; lineWidth?: number },
      ) => {
        if (stepBeats <= 0 || !Number.isFinite(stepBeats)) return
        if (stepBeats * pxPerBeat < 1.05) return
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
        ctx.lineWidth = opts?.lineWidth ?? 1
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.lineWidth = 1
      }

      // Fino → grueso (el primario se dibuja encima)
      const sorted = [...levels].sort((a, b) => a.spacingBeats - b.spacingBeats)
      for (const level of sorted) {
        const rank = zoomLevelRank(level.spacingBeats, primary)
        if (rank === 2) {
          strokeBeats(level.spacingBeats, 0.36, GRID_BLUE_SOFT, {
            skipIfOnStep: primary / 2,
            lineWidth: 1,
          })
        } else if (rank === 1) {
          strokeBeats(level.spacingBeats, 0.55, GRID_BLUE, {
            skipIfOnStep: primary,
            lineWidth: 1.35,
          })
        } else if (rank === 0) {
          strokeBeats(level.spacingBeats, 0.88, GRID_BLUE, { lineWidth: 1.75 })
        }
      }
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
  }, [projection.scrollX, projection, zoom, beatsPerBar, viewportWidth, contentHeight, pxPerBeat, snapDivision])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute top-0 z-0"
      aria-hidden
    />
  )
}

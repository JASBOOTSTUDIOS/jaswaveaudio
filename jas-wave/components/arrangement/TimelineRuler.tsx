import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { BASE_PIXELS_PER_BEAT } from './constants'
import {
  beatToViewX,
  crispX,
  formatRulerLabel,
  gridLevelsForZoom,
  majorBarInterval,
  pickZoomGridPrimary,
  zoomLevelRank,
} from './timeline-grid-math'

const MAX_CANVAS_EDGE = 8192
const MAX_TICKS = 8000
const GRID_BLUE = 'rgba(125, 211, 252, 1)'
const GRID_BLUE_SOFT = 'rgba(56, 189, 248, 1)'

/**
 * Regla: 3 niveles según zoom; números en el nivel primario.
 */
export function TimelineRuler({
  projection,
  zoom,
  beatsPerBar,
  viewportWidth,
  height = 40,
  getScrollX,
  scrollEpoch,
  /** Profundidad máxima (snap): no dibujar/numerar más fino que esto. */
  snapDivision = 0,
}: {
  projection: TimelineProjection
  zoom: number
  totalHeight?: number
  bpm?: number
  beatsPerBar: number
  contentWidth?: number
  viewportWidth: number
  height?: number
  getScrollX?: () => number
  scrollEpoch?: number
  snapDivision?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pxPerBeat = BASE_PIXELS_PER_BEAT * zoom

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const measured = wrap.clientWidth || viewportWidth
      if (measured <= 0) return
      const scrollX = getScrollX?.() ?? projection.scrollX

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cssW = Math.max(1, Math.min(Math.ceil(measured), MAX_CANVAS_EDGE))
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

      const primary = pickZoomGridPrimary(pxPerBeat, beatsPerBar, snapDivision)
      const levels = gridLevelsForZoom(pxPerBeat, beatsPerBar, snapDivision)
      const pxPerBar = pxPerBeat * beatsPerBar
      const barInterval = majorBarInterval(pxPerBar, 36)
      const startBeat = scrollX / pxPerBeat
      const endBeat = (scrollX + cssW) / pxPerBeat
      const toX = (beat: number) => crispX(beatToViewX(beat, pxPerBeat, scrollX))

      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textBaseline = 'top'
      ctx.lineWidth = 1

      // Números de compás cuando el primario es ≤ 1 compás (o cada N compases al alejarse)
      if (primary <= beatsPerBar + 1e-9) {
        const firstBar = Math.max(1, Math.floor(startBeat / beatsPerBar) - 1)
        const lastBar = Math.ceil(endBeat / beatsPerBar) + 2
        for (let bar = firstBar; bar <= lastBar; bar++) {
          const beatPos = (bar - 1) * beatsPerBar
          const x = toX(beatPos)
          if (x < -48 || x > cssW + 48) continue
          const isMajor = (bar - 1) % barInterval === 0
          if (!isMajor && pxPerBar < 10) continue
          if (isMajor) {
            ctx.fillStyle = muted
            ctx.fillText(String(bar), x + 4, 2)
          }
        }
      }

      for (const level of levels) {
        const step = level.spacingBeats
        if (step * pxPerBeat < 2) continue
        const rank = zoomLevelRank(step, primary)
        if (rank < 0) continue

        const first = Math.floor(startBeat / step) * step
        const showLabels = rank === 0 && step * pxPerBeat >= 22

        for (let n = 0; n < MAX_TICKS; n++) {
          const b = first + n * step
          if (b > endBeat + step) break
          if (b < -1e-9) continue

          // Evitar etiquetar/dibujar encima de otro nivel más grueso del trío
          if (rank > 0) {
            const coarser = rank === 1 ? primary : primary / 2
            const mod = ((b % coarser) + coarser) % coarser
            if (mod < 1e-6 || Math.abs(mod - coarser) < 1e-6) continue
          }

          const x = toX(b)
          if (x < -4 || x > cssW + 4) continue

          const tickTop = rank === 0 ? cssH * 0.16 : rank === 1 ? cssH * 0.34 : cssH * 0.5
          ctx.strokeStyle = rank === 2 ? GRID_BLUE_SOFT : GRID_BLUE
          ctx.globalAlpha = rank === 0 ? 0.92 : rank === 1 ? 0.58 : 0.38
          ctx.lineWidth = rank === 0 ? 1.7 : rank === 1 ? 1.25 : 1
          ctx.beginPath()
          ctx.moveTo(x, tickTop)
          ctx.lineTo(x, cssH)
          ctx.stroke()
          ctx.globalAlpha = 1
          ctx.lineWidth = 1

          if (showLabels) {
            // Si primary ≥ 1 compás, etiqueta como número de compás / bloque
            ctx.fillStyle = GRID_BLUE
            ctx.globalAlpha = 0.95
            ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            if (step >= beatsPerBar - 1e-9) {
              const barNum = Math.floor(b / beatsPerBar) + 1
              ctx.fillText(String(barNum), x + 3, 2)
            } else {
              ctx.fillText(formatRulerLabel(b, beatsPerBar, step), x + 3, 2)
            }
            ctx.globalAlpha = 1
            ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
          }
        }
      }
    }

    draw()
    const ro = new ResizeObserver(() => draw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [
    projection.scrollX,
    projection,
    zoom,
    beatsPerBar,
    viewportWidth,
    height,
    pxPerBeat,
    getScrollX,
    scrollEpoch,
    snapDivision,
  ])

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-0">
      <canvas ref={canvasRef} className="block h-full" aria-hidden />
    </div>
  )
}

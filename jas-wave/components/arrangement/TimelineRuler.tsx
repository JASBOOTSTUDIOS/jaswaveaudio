import { useEffect, useRef } from 'react'
import type { TimelineProjection } from '@/lib/timeline-projection'
import { adaptiveGridForZoom } from '../../../shared/src/midi/grid'
import { BASE_PIXELS_PER_BEAT } from './constants'
import { beatToViewX, crispX, majorBarInterval } from './timeline-grid-math'

const MAX_CANVAS_EDGE = 8192

/** Regla sticky — etiquetas alineadas con la rejilla (incl. subdivisiones). */
export function TimelineRuler({
  projection,
  zoom,
  beatsPerBar,
  viewportWidth,
  height = 40,
  getScrollX,
  scrollEpoch,
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
      const line =
        getComputedStyle(document.documentElement).getPropertyValue('--border').trim() ||
        'rgba(255,255,255,0.22)'

      const pxPerBar = pxPerBeat * beatsPerBar
      const barInterval = majorBarInterval(pxPerBar, 36)
      const levels = adaptiveGridForZoom(pxPerBeat, beatsPerBar)
      const startBeat = scrollX / pxPerBeat
      const endBeat = (scrollX + cssW) / pxPerBeat
      const toX = (beat: number) => crispX(beatToViewX(beat, pxPerBeat, scrollX))

      ctx.font = '500 10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
      ctx.textBaseline = 'top'
      ctx.lineWidth = 1

      const firstBar = Math.max(1, Math.floor(startBeat / beatsPerBar) - 1)
      const lastBar = Math.ceil(endBeat / beatsPerBar) + 2

      // Compases / beats etiquetados
      for (let bar = firstBar; bar <= lastBar; bar++) {
        const beatPos = (bar - 1) * beatsPerBar
        const x = toX(beatPos)
        if (x < -48 || x > cssW + 48) continue

        const isMajor = (bar - 1) % barInterval === 0
        if (!isMajor && pxPerBar < 10) continue

        ctx.strokeStyle = line
        ctx.globalAlpha = isMajor ? 0.95 : 0.4
        ctx.beginPath()
        ctx.moveTo(x, isMajor ? 0 : cssH * 0.35)
        ctx.lineTo(x, cssH)
        ctx.stroke()
        ctx.globalAlpha = 1

        if (isMajor) {
          ctx.fillStyle = muted
          ctx.fillText(String(bar), x + 4, 2)
        }

        // Beats dentro del compás
        if (pxPerBeat >= 14) {
          for (let b = 1; b < beatsPerBar; b++) {
            const bx = toX(beatPos + b)
            if (bx < -2 || bx > cssW + 2) continue
            ctx.strokeStyle = line
            ctx.globalAlpha = 0.35
            ctx.beginPath()
            ctx.moveTo(bx, cssH * 0.4)
            ctx.lineTo(bx, cssH)
            ctx.stroke()
            ctx.globalAlpha = 1
            if (pxPerBeat >= 28) {
              ctx.fillStyle = muted
              ctx.globalAlpha = 0.8
              ctx.fillText(`${bar}.${b + 1}`, bx + 3, 2)
              ctx.globalAlpha = 1
            }
          }
        }
      }

      // Subdivisiones con número (1/8 … 1/128) cuando hay espacio
      const labelStep = levels.find((l) => l.spacingBeats < 1 && l.spacingBeats * pxPerBeat >= 28)
      if (labelStep) {
        const step = labelStep.spacingBeats
        const first = Math.floor(startBeat / step) * step
        for (let n = 0; n < 8000; n++) {
          const b = first + n * step
          if (b > endBeat + step) break
          if (b < 0) continue
          // Saltar beats enteros (ya etiquetados)
          const modBeat = ((b % 1) + 1) % 1
          if (modBeat < 1e-6 || Math.abs(modBeat - 1) < 1e-6) continue
          const x = toX(b)
          if (x < -4 || x > cssW + 4) continue

          ctx.strokeStyle = line
          ctx.globalAlpha = 0.25
          ctx.beginPath()
          ctx.moveTo(x, cssH * 0.55)
          ctx.lineTo(x, cssH)
          ctx.stroke()
          ctx.globalAlpha = 1

          if (step * pxPerBeat >= 36) {
            const bar = Math.floor(b / beatsPerBar) + 1
            const beatInBar = Math.floor(b % beatsPerBar) + 1
            const sub = Math.round((b % 1) / step)
            ctx.fillStyle = muted
            ctx.globalAlpha = 0.65
            ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
            ctx.fillText(`${bar}.${beatInBar}.${sub}`, x + 2, 2)
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
  ])

  return (
    <div ref={wrapRef} className="pointer-events-none absolute inset-0 z-0">
      <canvas ref={canvasRef} className="block h-full" aria-hidden />
    </div>
  )
}

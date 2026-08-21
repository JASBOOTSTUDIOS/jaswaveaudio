import { useEffect, useRef } from 'react'
import { audioEngine } from '@/lib/audio-engine'
import { unpackStereoPeaks, type StereoPeakBucket } from '@/lib/stereo-peaks'
import { extractPeaksForPixelColumns, resamplePackedPeaks } from '@/lib/waveform-lod'

type Props = {
  waveform?: number[]
  sourceId?: string
  color: string
  /** Ancho total del clip en px (contenido). */
  width: number
  height?: number
  durationSeconds: number
  /** X del inicio del clip en el contenido. */
  clipLeft: number
  scrollLeft: number
  viewportWidth: number
  className?: string
}

/**
 * Waveform estilo Reaper:
 * - Solo pinta la porción visible del clip (canvas = viewport ∩ clip).
 * - Con AudioBuffer: 1 columna min/max por píxel (LOD).
 * - Zoom profundo: se ven oscilaciones muestra a muestra.
 * - Sin buffer: usa overview empaquetado.
 */
export function StereoWaveform({
  waveform,
  sourceId,
  color,
  width,
  height = 40,
  durationSeconds,
  clipLeft,
  scrollLeft,
  viewportWidth,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width <= 0 || height <= 0) return

    const visStart = Math.max(0, Math.min(width, scrollLeft - clipLeft))
    const visEnd = Math.max(0, Math.min(width, scrollLeft + viewportWidth - clipLeft))
    const visW = Math.max(0, Math.ceil(visEnd - visStart))
    if (visW < 1) {
      canvas.width = 0
      canvas.height = 0
      canvas.style.width = '0'
      canvas.style.height = '0'
      return
    }

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const h = Math.max(1, Math.floor(height))
    canvas.width = Math.floor(visW * dpr)
    canvas.height = Math.floor(h * dpr)
    canvas.style.width = `${visW}px`
    canvas.style.height = `${h}px`
    canvas.style.transform = `translateX(${visStart}px)`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, visW, h)

    const mid = h / 2
    const half = Math.max(1, mid - 1)

    // Línea central
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(visW, mid)
    ctx.stroke()

    const t0 = (visStart / width) * durationSeconds
    const t1 = (visEnd / width) * durationSeconds

    let peaks: StereoPeakBucket[] = []
    const buffer = sourceId ? audioEngine.getAudioBuffer(sourceId) : undefined

    if (buffer && durationSeconds > 0) {
      peaks = extractPeaksForPixelColumns(buffer, t0, t1, visW)
    } else if (waveform && waveform.length >= 4) {
      // Recortar overview al rango visible
      const all = unpackStereoPeaks(waveform)
      const a = Math.floor((visStart / width) * all.length)
      const b = Math.ceil((visEnd / width) * all.length)
      const slice = all.slice(Math.max(0, a), Math.min(all.length, Math.max(a + 1, b)))
      const packed: number[] = []
      for (const p of slice) {
        packed.push(p.minL, p.maxL, p.minR, p.maxR)
      }
      peaks = resamplePackedPeaks(packed, visW)
    }

    if (peaks.length === 0) {
      ctx.fillStyle = color
      ctx.globalAlpha = 0.25
      ctx.fillRect(0, mid - 1, visW, 2)
      ctx.globalAlpha = 1
      return
    }

    // Samples por píxel: si < ~2, trazo continuo (forma de onda)
    const samplesPerPx =
      buffer && durationSeconds > 0
        ? (buffer.sampleRate * (t1 - t0)) / Math.max(1, visW)
        : 999

    if (samplesPerPx <= 2.5 && buffer) {
      drawSamplePath(ctx, peaks, visW, mid, half, color)
    } else {
      drawPeakBars(ctx, peaks, visW, mid, half, color)
    }
  }, [
    waveform,
    sourceId,
    color,
    width,
    height,
    durationSeconds,
    clipLeft,
    scrollLeft,
    viewportWidth,
  ])

  return (
    <canvas
      ref={canvasRef}
      className={`pointer-events-none absolute left-0 top-0 ${className ?? ''}`}
      aria-hidden
    />
  )
}

function drawPeakBars(
  ctx: CanvasRenderingContext2D,
  peaks: StereoPeakBucket[],
  width: number,
  mid: number,
  half: number,
  color: string,
) {
  const n = peaks.length
  ctx.fillStyle = color
  for (let i = 0; i < n; i++) {
    const p = peaks[i]
    const x = i
    // L arriba (bipolar hacia centro)
    const lMax = Math.max(0, p.maxL)
    const lMin = Math.min(0, p.minL)
    const top = mid - lMax * half
    const bot = mid - lMin * half
    ctx.globalAlpha = 0.9
    ctx.fillRect(x, top, 1, Math.max(1, bot - top))

    // R abajo
    const rAmp = Math.max(Math.abs(p.minR), Math.abs(p.maxR))
    ctx.globalAlpha = 0.75
    ctx.fillRect(x, mid, 1, Math.max(1, rAmp * half))
  }
  ctx.globalAlpha = 1
}

function drawSamplePath(
  ctx: CanvasRenderingContext2D,
  peaks: StereoPeakBucket[],
  width: number,
  mid: number,
  half: number,
  color: string,
) {
  // Camino continuo L (arriba) usando valor medio / max
  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.globalAlpha = 0.95
  ctx.beginPath()
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]
    const y = mid - ((p.maxL + p.minL) / 2) * half
    if (i === 0) ctx.moveTo(i, y)
    else ctx.lineTo(i, y)
  }
  ctx.stroke()

  // R espejo abajo
  ctx.globalAlpha = 0.8
  ctx.beginPath()
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]
    const y = mid + ((p.maxR + p.minR) / 2) * half
    if (i === 0) ctx.moveTo(i, y)
    else ctx.lineTo(i, y)
  }
  ctx.stroke()

  // Relleno vertical min/max (envelope fino)
  ctx.globalAlpha = 0.35
  ctx.fillStyle = color
  for (let i = 0; i < peaks.length; i++) {
    const p = peaks[i]
    const top = mid - Math.max(Math.abs(p.minL), Math.abs(p.maxL)) * half
    ctx.fillRect(i, top, 1, Math.max(1, mid - top))
    const bot = mid + Math.max(Math.abs(p.minR), Math.abs(p.maxR)) * half
    ctx.fillRect(i, mid, 1, Math.max(1, bot - mid))
  }
  ctx.globalAlpha = 1
  void width
}

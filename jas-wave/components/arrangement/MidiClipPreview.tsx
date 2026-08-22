import { useEffect, useRef } from 'react'

export type MidiClipPreviewNote = {
  pitch: number
  inicio: number
  duracion: number
  velocidad?: number
  mute?: boolean
}

/** Mini piano-roll: figura real de las notas del clip (no un placeholder). */
export function MidiClipPreview({
  notes,
  durationBeats,
  color,
}: {
  notes: MidiClipPreviewNote[]
  durationBeats: number
  color: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return

    const draw = () => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (w < 2 || h < 2) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const audible = notes.filter((n) => !n.mute && Number.isFinite(n.pitch) && n.duracion > 0)
      if (audible.length === 0 || durationBeats <= 0) return

      let lo = 127
      let hi = 0
      for (const n of audible) {
        if (n.pitch < lo) lo = n.pitch
        if (n.pitch > hi) hi = n.pitch
      }
      lo = Math.max(0, lo - 1)
      hi = Math.min(127, hi + 1)
      const span = Math.max(12, hi - lo)
      const noteH = Math.max(2, Math.min(6, h / span))

      ctx.fillStyle = color
      const maxDraw = 2000
      const step = audible.length > maxDraw ? Math.ceil(audible.length / maxDraw) : 1
      for (let i = 0; i < audible.length; i += step) {
        const n = audible[i]!
        const x = (n.inicio / durationBeats) * w
        const nw = Math.max(1.25, (n.duracion / durationBeats) * w)
        const y = ((hi - n.pitch) / span) * (h - noteH)
        ctx.globalAlpha = 0.38 + Math.min(1, (n.velocidad ?? 100) / 127) * 0.5
        ctx.fillRect(x, y, nw, noteH)
      }
      ctx.globalAlpha = 1
    }

    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [notes, durationBeats, color])

  if (!notes.length) {
    return <div className="h-full w-full opacity-20" style={{ backgroundColor: color }} />
  }

  return (
    <div ref={wrapRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}

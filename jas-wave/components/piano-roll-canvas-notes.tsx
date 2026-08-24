/**
 * Capa de notas del piano roll en Canvas (virtualización para clips densos).
 * Hit-test + edge; gestos de drag los maneja el padre vía onHit.
 */

import { useEffect, useRef } from 'react'

export type CanvasNote = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
}

export type CanvasHit = { id: string; edge: false | 'start' | 'end' }

type Props = {
  notes: CanvasNote[]
  selectedIds: Set<string>
  width: number
  height: number
  pxPerBeat: number
  keyH: number
  highest: number
  lowest: number
  onHit?: (hit: CanvasHit | null, ev: PointerEvent) => void
}

export function PianoRollCanvasNotes({
  notes,
  selectedIds,
  width,
  height,
  pxPerBeat,
  keyH,
  highest,
  onHit,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(width * dpr))
    canvas.height = Math.max(1, Math.floor(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    for (const n of notes) {
      const top = (highest - n.pitch) * keyH + 1
      const left = n.inicio * pxPerBeat
      const w = Math.max(6, n.duracion * pxPerBeat)
      const h = keyH - 2
      const alpha = 0.35 + (n.velocidad / 127) * 0.55
      const selected = selectedIds.has(n.id)
      ctx.fillStyle = selected
        ? `rgba(251, 191, 36, ${Math.min(1, alpha + 0.2)})`
        : `rgba(139, 92, 246, ${alpha})`
      ctx.strokeStyle = selected ? 'rgba(251, 191, 36, 1)' : 'rgba(196, 181, 253, 0.45)'
      ctx.lineWidth = selected ? 1.5 : 1
      ctx.beginPath()
      const r = 2
      ctx.moveTo(left + r, top)
      ctx.arcTo(left + w, top, left + w, top + h, r)
      ctx.arcTo(left + w, top + h, left, top + h, r)
      ctx.arcTo(left, top + h, left, top, r)
      ctx.arcTo(left, top, left + w, top, r)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillRect(left + w - 3, top, 3, h)
    }
  }, [notes, selectedIds, width, height, pxPerBeat, keyH, highest])

  const hitTest = (clientX: number, clientY: number, el: HTMLCanvasElement): CanvasHit | null => {
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    for (let i = notesRef.current.length - 1; i >= 0; i--) {
      const n = notesRef.current[i]!
      const top = (highest - n.pitch) * keyH + 1
      const left = n.inicio * pxPerBeat
      const w = Math.max(6, n.duracion * pxPerBeat)
      const h = keyH - 2
      if (x >= left && x <= left + w && y >= top && y <= top + h) {
        if (x > left + w - 6) return { id: n.id, edge: 'end' }
        if (x < left + 6) return { id: n.id, edge: 'start' }
        return { id: n.id, edge: false }
      }
    }
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute left-0 top-0 z-10"
      style={{ width, height }}
      onPointerDown={(e) => {
        if (!onHit) return
        const hit = hitTest(e.clientX, e.clientY, e.currentTarget)
        onHit(hit, e.nativeEvent)
      }}
    />
  )
}

export function shouldUseCanvasNotes(count: number): boolean {
  return count >= 64
}

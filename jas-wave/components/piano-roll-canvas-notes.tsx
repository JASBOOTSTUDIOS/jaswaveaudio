/**
 * Capa de notas del piano roll en Canvas (virtualización para clips densos).
 *
 * El canvas NO cubre toda la rejilla: sólo la ventana visible (+ margen) del contenedor
 * con scroll. Antes medía `duración_total * pxPerBeat` x `73 * keyH` px (decenas de
 * miles de px de ancho y por encima del máximo del canvas en Chromium), y se realocaba
 * en cada cambio de notas (cada pointermove al arrastrar).
 *
 * Hit-test + edge; gestos de drag los maneja el padre vía onHit.
 */

import { useEffect, useRef, useState, type RefObject } from 'react'

export type CanvasNote = {
  id: string
  pitch: number
  inicio: number
  duracion: number
  velocidad: number
  /** Silenciada: se dibuja al 35 % con borde discontinuo. */
  mute?: boolean
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
  /** Contenedor que scrollea horizontalmente (define la ventana visible). */
  scrollRef: RefObject<HTMLElement | null>
  onHit?: (hit: CanvasHit | null, ev: PointerEvent) => void
  /** false: el clic izquierdo pasa a la rejilla (herramienta tijera). */
  interceptar?: boolean
}

/** Margen a cada lado de la ventana visible (px) y paso de cuantización del origen. */
const PAD_PX = 256
const CHUNK_PX = 256

export type CanvasView = { x0: number; w: number }

/** Origen y ancho del canvas (en px de rejilla) para un scroll dado. Puro: se prueba aparte. */
export function computeCanvasView(
  scrollLeft: number,
  clientWidth: number,
  totalWidth: number,
): CanvasView {
  const x0 = Math.max(0, Math.floor((scrollLeft - PAD_PX) / CHUNK_PX) * CHUNK_PX)
  const w = Math.max(1, Math.min(totalWidth - x0, clientWidth + 2 * PAD_PX + 2 * CHUNK_PX))
  return { x0, w }
}

/**
 * Ventana visible horizontal del contenedor con scroll (scroll + resize coalescidos a un
 * frame; libera listeners y observer al desmontar). Sólo cambia de estado al cruzar un
 * paso de CHUNK_PX, no en cada píxel de scroll.
 */
export function useScrollView(scrollRef: RefObject<HTMLElement | null>, totalWidth: number): CanvasView {
  const [view, setView] = useState<CanvasView>(() => computeCanvasView(0, 1600, totalWidth))
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const next = computeCanvasView(el.scrollLeft, el.clientWidth || 1600, totalWidth)
      setView((v) => (v.x0 === next.x0 && v.w === next.w ? v : next))
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    ro?.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      el.removeEventListener('scroll', schedule)
      ro?.disconnect()
    }
  }, [scrollRef, totalWidth])
  return view
}

export function PianoRollCanvasNotes({
  notes,
  selectedIds,
  width,
  height,
  pxPerBeat,
  keyH,
  highest,
  scrollRef,
  onHit,
  interceptar = true,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const notesRef = useRef(notes)
  notesRef.current = notes
  const view = useScrollView(scrollRef, width)
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(1, Math.floor(view.w * dpr))
    const ch = Math.max(1, Math.floor(height * dpr))
    // Asignar width/height realoca el bitmap incluso con el mismo valor.
    if (canvas.width !== cw) canvas.width = cw
    if (canvas.height !== ch) canvas.height = ch
    canvas.style.width = `${view.w}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, -view.x0 * dpr, 0)
    ctx.clearRect(view.x0, 0, view.w, height)

    const xMin = view.x0
    const xMax = view.x0 + view.w
    for (const n of notes) {
      const left = n.inicio * pxPerBeat
      const w = Math.max(6, n.duracion * pxPerBeat)
      if (left + w < xMin || left > xMax) continue
      const top = (highest - n.pitch) * keyH + 1
      const h = keyH - 2
      const alpha = 0.35 + (n.velocidad / 127) * 0.55
      const selected = selectedIds.has(n.id)
      ctx.fillStyle = selected
        ? `rgba(251, 191, 36, ${Math.min(1, alpha + 0.2)})`
        : `rgba(139, 92, 246, ${alpha})`
      ctx.strokeStyle = selected ? 'rgba(251, 191, 36, 1)' : 'rgba(196, 181, 253, 0.45)'
      ctx.lineWidth = selected ? 1.5 : 1
      ctx.globalAlpha = n.mute ? 0.35 : 1
      ctx.setLineDash(n.mute ? [3, 2] : [])
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
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.fillRect(left, top, 4, h)
      ctx.fillRect(left + w - 4, top, 4, h)
    }
    ctx.globalAlpha = 1
    ctx.setLineDash([])
  }, [notes, selectedIds, view, height, pxPerBeat, keyH, highest])

  const hitTest = (clientX: number, clientY: number, el: HTMLCanvasElement): CanvasHit | null => {
    const rect = el.getBoundingClientRect()
    // El canvas está desplazado `x0` px dentro de la rejilla.
    const x = clientX - rect.left + viewRef.current.x0
    const y = clientY - rect.top
    for (let i = notesRef.current.length - 1; i >= 0; i--) {
      const n = notesRef.current[i]!
      const top = (highest - n.pitch) * keyH + 1
      const left = n.inicio * pxPerBeat
      const w = Math.max(6, n.duracion * pxPerBeat)
      const h = keyH - 2
      if (x >= left && x <= left + w && y >= top && y <= top + h) {
        if (x > left + w - 8) return { id: n.id, edge: 'end' }
        if (x < left + 8) return { id: n.id, edge: 'start' }
        return { id: n.id, edge: false }
      }
    }
    return null
  }

  return (
    <canvas
      ref={canvasRef}
      className="absolute top-0 z-10 touch-none"
      style={{ left: view.x0, width: view.w, height }}
      onPointerDown={(e) => {
        // Clic derecho sobre nota: borrar (el padre decide). Vacío: burbujear para marquee.
        if (e.button === 2) {
          if (!onHit) return
          const hit = hitTest(e.clientX, e.clientY, e.currentTarget)
          if (!hit) return
          e.stopPropagation()
          e.preventDefault()
          onHit(hit, e.nativeEvent)
          return
        }
        if (e.button !== 0 || !onHit || !interceptar) return
        const hit = hitTest(e.clientX, e.clientY, e.currentTarget)
        if (!hit) return
        e.stopPropagation()
        e.preventDefault()
        onHit(hit, e.nativeEvent)
      }}
      onContextMenu={(e) => e.preventDefault()}
    />
  )
}

export function shouldUseCanvasNotes(count: number): boolean {
  return count >= 64
}

/**
 * Carriles de la cabecera (marcadores, acordes, letra): siguen el scroll horizontal de las pistas con un
 * RAF ligero que mueve un `translate3d` (como el playhead), sin re-render de React por frame.
 */
import { useEffect, type RefObject } from 'react'

export function useLaneScrollFollow(ref: RefObject<HTMLElement | null>, getScrollX: () => number): void {
  useEffect(() => {
    let raf = 0
    let last = Number.NaN
    const tick = () => {
      const el = ref.current
      if (el) {
        const x = getScrollX()
        if (x !== last) {
          last = x
          el.style.transform = `translate3d(${-x}px, 0, 0)`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ref, getScrollX])
}

/** Beat (sin snap) a partir de una X de cliente sobre un carril que sigue el scroll. */
export function clientXToLaneBeat(clientX: number, lane: HTMLElement, pixelsPerBeat: number, scrollX: number): number {
  const rect = lane.getBoundingClientRect()
  return Math.max(0, (clientX - rect.left + scrollX) / Math.max(1e-6, pixelsPerBeat))
}

/** Arrastre horizontal con umbral: devuelve true si hubo desplazamiento real (para distinguir del clic). */
export function arrastreHorizontal(
  e: React.PointerEvent,
  onMove: (dxPx: number) => void,
  onEnd: (dxPx: number, movido: boolean) => void,
  umbralPx = 3,
): void {
  const x0 = e.clientX
  let movido = false
  let dx = 0
  const move = (ev: PointerEvent) => {
    dx = ev.clientX - x0
    if (!movido && Math.abs(dx) < umbralPx) return
    movido = true
    onMove(dx)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('pointercancel', up)
    onEnd(dx, movido)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

import { useEffect, useState, type RefObject } from 'react'

/** Tamaño (px) del contenido de un elemento, actualizado con ResizeObserver. 0×0 hasta la primera medida. */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const apply = (w: number, h: number) =>
      setSize((prev) => (Math.abs(prev.width - w) < 1 && Math.abs(prev.height - h) < 1 ? prev : { width: Math.round(w), height: Math.round(h) }))
    apply(el.clientWidth, el.clientHeight)
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) apply(r.width, r.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

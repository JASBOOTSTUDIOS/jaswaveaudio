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

/**
 * Nivel de densidad según una medida con histéresis: no cambia de nivel hasta rebasar el umbral por un
 * margen, así un valor que oscila unos píxeles en el límite no hace parpadear la interfaz entre modos.
 * `umbrales` en orden ascendente; devuelve 0..umbrales.length (0 = el espacio más holgado... ver uso).
 */
export function useTierConHisteresis(valor: number, umbrales: readonly number[], margen = 14): number {
  const [tier, setTier] = useState(() => calcTier(valor, umbrales))
  useEffect(() => {
    setTier((prev) => {
      if (valor <= 0) return 0
      // subir de nivel (más espacio) exige superar el umbral + margen; bajar, quedar por debajo del umbral
      let t = prev
      while (t < umbrales.length && valor >= umbrales[t]! + margen) t++
      while (t > 0 && valor < umbrales[t - 1]!) t--
      return t
    })
  }, [valor, umbrales, margen])
  return tier
}

function calcTier(valor: number, umbrales: readonly number[]): number {
  if (valor <= 0) return 0
  let t = 0
  while (t < umbrales.length && valor >= umbrales[t]!) t++
  return t
}

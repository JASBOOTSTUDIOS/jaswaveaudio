import { useCallback, useRef } from 'react'

type Options = {
  value: number
  min: number
  max: number
  /** unidades de valor por cada pixel de arrastre vertical (hacia arriba = +) */
  sensitivity?: number
  onChange: (value: number) => void
  /** valor al que vuelve con doble clic (por defecto no hace nada) */
  resetTo?: number
}

/**
 * Hook de arrastre vertical estilo DAW.
 * Arrastrar hacia arriba incrementa el valor, hacia abajo lo reduce.
 * Mantener Shift reduce la sensibilidad para ajuste fino.
 */
export function useDragValue({
  value,
  min,
  max,
  sensitivity = 0.5,
  onChange,
  resetTo,
}: Options) {
  const startY = useRef(0)
  const startValue = useRef(0)

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const target = e.currentTarget as HTMLElement
      target.setPointerCapture(e.pointerId)
      startY.current = e.clientY
      startValue.current = value

      const handleMove = (ev: PointerEvent) => {
        const dy = startY.current - ev.clientY
        const fine = ev.shiftKey ? 0.25 : 1
        const next = startValue.current + dy * sensitivity * fine
        onChange(Math.max(min, Math.min(max, next)))
      }

      const handleUp = (ev: PointerEvent) => {
        target.releasePointerCapture?.(ev.pointerId)
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
      document.body.style.cursor = 'ns-resize'
      document.body.style.userSelect = 'none'
    },
    [value, min, max, sensitivity, onChange],
  )

  const onDoubleClick = useCallback(() => {
    if (resetTo !== undefined) onChange(resetTo)
  }, [resetTo, onChange])

  return { onPointerDown, onDoubleClick }
}

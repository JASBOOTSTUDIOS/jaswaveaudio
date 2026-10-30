/**
 * Punto de inicio del transporte (al que vuelve Stop): triángulo en la regla y línea discontinua sobre las
 * pistas. Lo fija el clic del usuario en la línea de tiempo; W / Inicio lo devuelve a cero.
 * Sigue el scroll horizontal con un RAF ligero (como el playhead), sin re-render de React.
 */
import { useEffect, useRef } from 'react'
import { useDAWState } from '@/src/context/daw-context'
import { puntoInicioDe } from '../../../shared/src/commands/domain-commands'

export function StartMarkerOverlay({
  bpm,
  pixelsPerBeat,
  getScrollX,
}: {
  bpm: number
  pixelsPerBeat: number
  getScrollX: () => number
}) {
  const puntoSeg = useDAWState((s) => puntoInicioDe(s.transport))
  const ref = useRef<HTMLDivElement>(null)
  const datos = useRef({ puntoSeg, bpm, pixelsPerBeat, getScrollX })
  datos.current = { puntoSeg, bpm, pixelsPerBeat, getScrollX }

  useEffect(() => {
    let raf = 0
    let lastX = Number.NaN
    const tick = () => {
      const el = ref.current
      const d = datos.current
      if (el && d.pixelsPerBeat > 0) {
        const x = ((d.puntoSeg * d.bpm) / 60) * d.pixelsPerBeat - d.getScrollX()
        if (x !== lastX) {
          lastX = x
          el.style.transform = `translate3d(${x}px, 0, 0)`
          el.style.visibility = x < -8 ? 'hidden' : 'visible'
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div
      ref={ref}
      data-testid="start-marker"
      className="pointer-events-none absolute top-0 bottom-0 z-20 w-0 border-l border-dashed border-accent-cyan/70 will-change-transform"
      style={{ left: 0 }}
      title="Punto de inicio (Stop vuelve aquí · W lo lleva a 0)"
      aria-hidden
    >
      <div
        className="absolute -left-[5px] top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent-cyan"
      />
    </div>
  )
}

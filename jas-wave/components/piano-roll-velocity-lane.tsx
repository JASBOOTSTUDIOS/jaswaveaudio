/**
 * Carril de velocity del piano roll, virtualizado horizontalmente.
 *
 * Antes se montaba un <div> por nota (miles en clips densos) en cada render del piano
 * roll — incluido cada pointermove al arrastrar. Ahora sólo se montan las barras que
 * caen en la ventana visible (+ margen) y el componente es memo: no se re-renderiza si
 * no cambian sus props.
 */
import { memo, useMemo, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useScrollView } from '@/components/piano-roll-canvas-notes'

export type VelocityLaneNote = {
  id: string
  inicio: number
  duracion: number
  velocidad: number
}

type Props = {
  notes: VelocityLaneNote[]
  selectedIds: Set<string>
  pxPerBeat: number
  gridWidth: number
  top: number
  height: number
  scrollRef: RefObject<HTMLElement | null>
  onBarPointerDown: (e: ReactPointerEvent<HTMLDivElement>, noteId: string) => void
}

function PianoRollVelocityLaneImpl({
  notes,
  selectedIds,
  pxPerBeat,
  gridWidth,
  top,
  height,
  scrollRef,
  onBarPointerDown,
}: Props) {
  const view = useScrollView(scrollRef, gridWidth)
  const xMin = view.x0
  const xMax = view.x0 + view.w
  const visibles = useMemo(
    () =>
      notes.filter((n) => {
        const left = n.inicio * pxPerBeat
        return left + 14 >= xMin && left <= xMax
      }),
    [notes, pxPerBeat, xMin, xMax],
  )

  return (
    <div
      className="absolute left-0 border-t border-border bg-panel-raised/80"
      style={{ top, width: gridWidth, height }}
    >
      {visibles.map((n) => {
        const left = n.inicio * pxPerBeat
        const width = Math.max(4, n.duracion * pxPerBeat)
        const h = (n.velocidad / 127) * (height - 8)
        const selected = selectedIds.has(n.id)
        return (
          <div
            key={`v-${n.id}`}
            data-note
            className={`absolute bottom-1 cursor-ns-resize rounded-sm ${
              selected ? 'bg-accent-amber' : 'bg-violet-500/70'
            }`}
            style={{ left, width: Math.min(width, 14), height: Math.max(3, h) }}
            title={`Velocity ${n.velocidad} · clic central: velocity inicial`}
            onPointerDown={(e) => onBarPointerDown(e, n.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault() // sin autoscroll del navegador
            }}
          />
        )
      })}
    </div>
  )
}

export const PianoRollVelocityLane = memo(PianoRollVelocityLaneImpl)
